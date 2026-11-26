use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, State};

use crate::secure_vault::{config_dir_file, read_encrypted_json_or_migrate, write_encrypted_json};

const DEFAULT_GATEWAY_API: &str = "https://supremeai-api-ulw0.onrender.com";
// বাংলা মন্তব্য: পুরনো supremeai-primary-node হোস্টটি আর বিদ্যমান নেই (মৃত লিংক) — লাইভ core API এখন -5xso Render ইনস্ট্যান্সে চলছে। SUPREMEAI_CORE_URL দিয়ে ওভাররাইড করা যাবে।
const DEFAULT_CORE_API: &str = "https://supremeai-primary-node-5xso.onrender.com";
const MAX_ADMIN_RESPONSE_BYTES: u64 = 1_000_000;

fn resolve_https_endpoint(env_key: &str, default_url: &str) -> Result<String, String> {
    let resolved = std::env::var(env_key)
        .ok()
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_url.to_string());
    if !resolved.starts_with("https://") {
        return Err("Admin endpoint must use HTTPS.".to_string());
    }
    Ok(resolved)
}

fn gateway_api() -> Result<String, String> {
    resolve_https_endpoint("SUPREMEAI_API_URL", DEFAULT_GATEWAY_API)
}

fn core_api() -> Result<String, String> {
    resolve_https_endpoint("SUPREMEAI_CORE_URL", DEFAULT_CORE_API)
}

fn admin_login_path(mode: &str) -> Result<&'static str, String> {
    match mode {
        "owner" => Ok("/api/admin/login"),
        _ => Err("Tenant administrator sign-in is not enabled in this desktop release.".to_string()),
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct AdminSession {
    pub token: String,
    pub role: String,
    pub email: String,
}

/// Tokens are kept in process memory and optionally persisted in an AES-256-GCM
/// sealed vault file; they are never returned to the WebView or written to localStorage.
#[derive(Default)]
pub struct AdminSessionState {
    session: Mutex<Option<AdminSession>>,
    pending_cookies: Mutex<Vec<String>>,
}

const ADMIN_SESSION_FILE: &str = "admin_session.json";

fn extract_set_cookies(headers: &reqwest::header::HeaderMap) -> Vec<String> {
    headers
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|val| val.to_str().ok())
        .filter_map(|raw| raw.split(';').next().map(str::trim))
        .filter(|pair| pair.contains('=') && !pair.starts_with('='))
        .map(str::to_string)
        .collect()
}

// Persisted admin session sealed via AES-256-GCM.
// Kill switch: SUPREMEAI_DESKTOP_NO_PERSIST_SESSION=1 restores in-memory-only behavior.
fn persist_session(app: &AppHandle, session: &AdminSession) {
    if std::env::var("SUPREMEAI_DESKTOP_NO_PERSIST_SESSION").is_ok() {
        return;
    }
    let _ = write_encrypted_json(app, ADMIN_SESSION_FILE, session);
}

pub fn seed_session(state: &AdminSessionState, session: AdminSession) {
    if let Ok(mut current) = state.session.lock() {
        *current = Some(session);
    }
}

pub fn load_persisted_session(app: &AppHandle, state: &AdminSessionState) {
    if let Some(session) = read_encrypted_json_or_migrate::<AdminSession>(app, ADMIN_SESSION_FILE) {
        seed_session(state, session);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminLoginResult {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(60)) // Render free-tier cold starts take 30-50s; 20s caused false session failures
        .build()
        .map_err(|_| "Could not initialize the secure admin connection.".to_string())
}

fn api_error(status: reqwest::StatusCode, context: &str) -> String {
    match (context, status.as_u16()) {
        ("login", 401) => "Invalid email, password, or verification code.".to_string(),
        ("login", 403) => "This account is not authorized for that workspace.".to_string(),
        (_, 401) => "Your admin session may have expired. Sign in again.".to_string(),
        (_, 403) => "This account is not authorized to view this data.".to_string(),
        (_, 404) => "The requested admin data is not available.".to_string(),
        (_, 503) => "The admin service is temporarily unavailable.".to_string(),
        _ => "The admin service returned an error. Please try again.".to_string(),
    }
}

async fn parse_json_response(response: reqwest::Response, context: &str) -> Result<Value, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(api_error(status, context));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_ADMIN_RESPONSE_BYTES)
    {
        return Err("The admin service returned an oversized response.".to_string());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "The admin service returned an unreadable response.".to_string())?;
    if bytes.len() as u64 > MAX_ADMIN_RESPONSE_BYTES {
        return Err("The admin service returned an oversized response.".to_string());
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| "The admin service returned an unreadable response.".to_string())
}

fn store_session(
    state: &AdminSessionState,
    app: &AppHandle,
    token: String,
    role: String,
    email: String,
) -> Result<(), String> {
    if token.is_empty() || token.len() > 16_384 {
        return Err("The admin service returned an invalid session.".to_string());
    }
    let session = AdminSession { token, role, email };
    let mut current = state
        .session
        .lock()
        .map_err(|_| "The admin session could not be updated.".to_string())?;
    *current = Some(session.clone());
    drop(current);
    persist_session(app, &session);
    Ok(())
}

fn current_session(state: &AdminSessionState) -> Result<AdminSession, String> {
    state
        .session
        .lock()
        .map_err(|_| "The admin session could not be read.".to_string())?
        .clone()
        .ok_or_else(|| "Sign in to the admin workspace first.".to_string())
}

#[tauri::command]
pub async fn admin_login(
    mode: String,
    email: String,
    password: String,
    app: AppHandle,
    state: State<'_, AdminSessionState>,
) -> Result<AdminLoginResult, String> {
    let email = email.trim().to_lowercase();
    if email.is_empty()
        || email.len() > 254
        || email.chars().any(char::is_control)
        || password.is_empty()
        || password.len() > 1024
    {
        return Err("Enter a valid email and password.".to_string());
    }

    let gateway = gateway_api()?;
    let endpoint = format!("{gateway}{}", admin_login_path(&mode)?);
    let http = client()?;
    let response = http
        .post(endpoint)
        .json(&json!({ "email": email, "password": password }))
        .send()
        .await
        .map_err(|_| "The SupremeAI authentication service could not be reached.".to_string())?;
    let set_cookies = extract_set_cookies(response.headers());
    let data = parse_json_response(response, "login").await?;

    match data.get("status").and_then(Value::as_str).unwrap_or_default() {
        "otp_required" => {
            if let Ok(mut pending) = state.pending_cookies.lock() {
                *pending = set_cookies;
            }
            return Ok(AdminLoginResult {
                status: "otp_required".to_string(),
                role: None,
                email: Some(email),
            });
        }
        "totp_setup_required" => {
            if let Ok(mut pending) = state.pending_cookies.lock() {
                *pending = set_cookies;
            }
            return Ok(AdminLoginResult {
                status: "totp_setup_required".to_string(),
                role: None,
                email: Some(email),
            });
        }
        "authenticated" | "trusted_browser" => {
            if let Ok(mut pending) = state.pending_cookies.lock() {
                pending.clear();
            }
        }
        _ => return Err("The owner sign-in could not be completed.".to_string()),
    }

    let role = data
        .get("role")
        .and_then(Value::as_str)
        .ok_or_else(|| "The authentication service returned an invalid role.".to_string())?;
    if role != "admin" {
        return Err("This account is not authorized for that workspace.".to_string());
    }
    let token = data
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| "The authentication service returned an invalid session.".to_string())?
        .to_string();
    let session_email = data
        .get("email")
        .and_then(Value::as_str)
        .unwrap_or(&email)
        .to_string();
    store_session(&state, &app, token, role.to_string(), session_email.clone())?;
    Ok(AdminLoginResult {
        status: "authenticated".to_string(),
        role: Some(role.to_string()),
        email: Some(session_email),
    })
}

#[tauri::command]
pub async fn admin_verify_totp(
    otp: String,
    app: AppHandle,
    state: State<'_, AdminSessionState>,
) -> Result<AdminLoginResult, String> {
    let otp = otp.trim();
    if otp.len() != 6 || !otp.chars().all(|character| character.is_ascii_digit()) {
        return Err("Enter the six-digit verification code.".to_string());
    }
    let http = client()?;
    let pending_cookie_header = state
        .pending_cookies
        .lock()
        .ok()
        .filter(|cookies| !cookies.is_empty())
        .map(|cookies| cookies.join("; "));
    let gateway = gateway_api()?;
    let mut request = http
        .post(format!("{gateway}/api/admin/totp-verify"))
        .json(&json!({ "otp": otp, "remember_browser": true }));
    if let Some(cookie_header) = pending_cookie_header {
        request = request.header(reqwest::header::COOKIE, cookie_header);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "The SupremeAI authentication service could not be reached.".to_string())?;
    let data = parse_json_response(response, "login").await?;
    if let Ok(mut pending) = state.pending_cookies.lock() {
        pending.clear();
    }
    let token = data
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| "The authentication service returned an invalid session.".to_string())?
        .to_string();
    let role = data
        .get("role")
        .and_then(Value::as_str)
        .filter(|role| *role == "admin")
        .ok_or_else(|| "The authentication service returned an invalid role.".to_string())?;
    let email = data
        .get("email")
        .and_then(Value::as_str)
        .unwrap_or("Platform owner")
        .to_string();
    store_session(&state, &app, token, role.to_string(), email.clone())?;
    Ok(AdminLoginResult {
        status: "authenticated".to_string(),
        role: Some(role.to_string()),
        email: Some(email),
    })
}

#[tauri::command]
pub async fn admin_dashboard(state: State<'_, AdminSessionState>) -> Result<Value, String> {
    let session = current_session(&state)?;
    if session.role != "admin" {
        return Err("This account is not authorized to view the admin workspace.".to_string());
    }
    let gateway = gateway_api()?;
    let core = core_api()?;
    let http = client()?;

    let tenant_response = http
        .get(format!("{gateway}/api/admin/tenant-overview"))
        .bearer_auth(&session.token)
        .send()
        .await
        .map_err(|_| "The platform admin service could not be reached.".to_string())?;
    let tenant_overview = parse_json_response(tenant_response, "dashboard").await?;

    let health_response = http
        .get(format!("{core}/admin-api/health-map"))
        .bearer_auth(&session.token)
        .send()
        .await
        .map_err(|_| "The system health service could not be reached.".to_string())?;
    let health = parse_json_response(health_response, "dashboard").await?;
    Ok(json!({
        "scope": "platform",
        "role": "admin",
        "email": session.email,
        "tenantOverview": tenant_overview,
        "health": health,
    }))
}

#[tauri::command]
pub async fn admin_logout(app: AppHandle, state: State<'_, AdminSessionState>) -> Result<(), String> {
    let session = state
        .session
        .lock()
        .map_err(|_| "The admin session could not be cleared.".to_string())?
        .take();
    if let Ok(mut pending) = state.pending_cookies.lock() {
        pending.clear();
    }
    // Explicit sign-out also clears the persisted session file.
    let _ = config_dir_file(&app, ADMIN_SESSION_FILE).map(std::fs::remove_file);
    if let Some(session) = session {
        if let (Ok(gateway), Ok(http)) = (gateway_api(), client()) {
            let _ = http
                .post(format!("{gateway}/api/admin/logout"))
                .bearer_auth(session.token)
                .send()
                .await;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{admin_login_path, extract_set_cookies};

    #[test]
    fn desktop_admin_login_only_allows_platform_owner() {
        assert_eq!(admin_login_path("owner").unwrap(), "/api/admin/login");
        assert!(admin_login_path("tenant_admin").is_err());
        assert!(admin_login_path("unknown").is_err());
    }

    #[test]
    fn extract_set_cookies_strips_attributes() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.append(
            reqwest::header::SET_COOKIE,
            "admin_challenge=abc123; Path=/; HttpOnly; Secure".parse().unwrap(),
        );
        assert_eq!(extract_set_cookies(&headers), vec!["admin_challenge=abc123"]);
    }
}
