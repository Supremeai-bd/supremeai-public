use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::secure_vault::sha256_hex_file;

const MAX_BINARY_BYTES: u64 = 350 * 1024 * 1024;
const MIN_BINARY_BYTES: u64 = 100 * 1024;
const PENDING_UPDATE_FILE: &str = "pending_update.json";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRuntimeInfo {
    pub version: String,
    pub os: String,
    pub arch: String,
    pub is_windows: bool,
    pub is_android: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingUpdateRecord {
    pub version: String,
    pub tag: String,
    pub file_path: String,
    pub file_name: String,
    pub url: String,
    pub staged_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedUpdateInfo {
    pub file_path: String,
    pub file_name: String,
    pub version: String,
    pub size_bytes: u64,
    pub already_cached: bool,
    pub pending_on_next_startup: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyUpdateResult {
    pub launched: bool,
    pub silent: bool,
    pub mode: String,
    pub message: String,
}

pub fn parse_semver(raw: &str) -> (u64, u64, u64) {
    let cleaned = raw
        .trim()
        .trim_start_matches('v')
        .trim_start_matches('V')
        .split('-')
        .next()
        .unwrap_or("0.0.0");
    let mut parts = cleaned.split('.').map(|part| part.parse::<u64>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

pub fn semver_gt(candidate: &str, current: &str) -> bool {
    parse_semver(candidate) > parse_semver(current)
}

pub fn is_allowed_release_url(url: &str) -> bool {
    let trimmed = url.trim();
    trimmed.starts_with("https://github.com/Supremeai-bd/")
        || trimmed.starts_with("https://supremeai-studio.pages.dev/")
}

pub fn sanitize_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 160 || trimmed.contains("..") {
        return Err("Invalid installer file name.".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return Err("Installer file name contains disallowed characters.".to_string());
    }
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.ends_with(".exe") || lower.ends_with(".msi") || lower.ends_with(".apk")) {
        return Err("Only .exe, .msi, or .apk installers can be staged.".to_string());
    }
    Ok(trimmed.to_string())
}

pub fn has_valid_binary_header(file_name: &str, bytes: &[u8]) -> bool {
    let lower = file_name.to_ascii_lowercase();
    if lower.ends_with(".exe") {
        bytes.len() >= 2 && &bytes[..2] == b"MZ"
    } else if lower.ends_with(".apk") {
        bytes.len() >= 2 && &bytes[..2] == b"PK"
    } else if lower.ends_with(".msi") {
        bytes.len() >= 4 && bytes[..4] == [0xD0, 0xCF, 0x11, 0xE0]
    } else {
        false
    }
}

pub fn normalize_sha256_hex(raw: Option<&str>) -> Result<Option<String>, String> {
    let Some(val) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let lower = val.to_ascii_lowercase();
    if lower.len() != 64 || !lower.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return Err("Expected SHA-256 checksum must be a 64-character hex string.".to_string());
    }
    Ok(Some(lower))
}

pub fn verify_file_sha256(path: &Path, expected: Option<&str>) -> Result<String, String> {
    let actual = sha256_hex_file(path)?;
    if let Some(exp) = expected {
        if actual != exp.to_ascii_lowercase() {
            return Err("Downloaded installer failed SHA-256 integrity verification.".to_string());
        }
    }
    Ok(actual)
}

pub fn is_path_inside_updates_dir(updates_dir: &Path, candidate: &Path) -> bool {
    let Ok(canon_dir) = fs::canonicalize(updates_dir) else {
        return false;
    };
    let Ok(canon_candidate) = fs::canonicalize(candidate) else {
        return false;
    };
    canon_candidate.starts_with(&canon_dir) && canon_candidate.is_file()
}

fn updates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| "Could not resolve app cache directory.".to_string())?;
    let dir = cache_dir.join("updates");
    fs::create_dir_all(&dir).map_err(|err| format!("Failed to prepare updates directory: {err}"))?;
    Ok(dir)
}

fn pending_manifest_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(updates_dir(app)?.join(PENDING_UPDATE_FILE))
}

fn persist_pending_record(app: &AppHandle, record: &PendingUpdateRecord) {
    if let Ok(path) = pending_manifest_path(app) {
        if let Ok(bytes) = serde_json::to_vec_pretty(record) {
            let _ = fs::write(path, bytes);
        }
    }
}

fn read_pending_record(app: &AppHandle) -> Option<PendingUpdateRecord> {
    let path = pending_manifest_path(app).ok()?;
    let bytes = fs::read(&path).ok()?;
    serde_json::from_slice::<PendingUpdateRecord>(&bytes).ok()
}

fn now_epoch_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn extract_version_hint(file_name: &str, fallback: &str) -> String {
    if let Some(idx) = file_name.find('_') {
        let rest = &file_name[idx + 1..];
        if let Some(end) = rest.find('_') {
            let candidate = rest[..end].trim();
            if !candidate.is_empty() && candidate.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                return candidate.to_string();
            }
        }
    }
    fallback.trim().trim_start_matches(['v', 'V']).to_string()
}

#[tauri::command]
pub fn get_app_runtime_info(app: AppHandle) -> AppRuntimeInfo {
    AppRuntimeInfo {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        is_windows: cfg!(target_os = "windows"),
        is_android: cfg!(target_os = "android"),
    }
}

#[tauri::command]
pub fn get_pending_update(app: AppHandle) -> Option<PendingUpdateRecord> {
    let dir = updates_dir(&app).ok()?;
    let record = read_pending_record(&app)?;
    let current_version = app.package_info().version.to_string();

    if !semver_gt(&record.version, &current_version)
        || !is_path_inside_updates_dir(&dir, &PathBuf::from(&record.file_path))
    {
        let _ = clear_pending_update_files(&app, Some(&record.file_path));
        return None;
    }

    Some(record)
}

#[tauri::command]
pub fn clear_pending_update(app: AppHandle) {
    let existing = read_pending_record(&app);
    let _ = clear_pending_update_files(
        &app,
        existing.as_ref().map(|record| record.file_path.as_str()),
    );
}

fn clear_pending_update_files(app: &AppHandle, staged_file: Option<&str>) -> Result<(), String> {
    let dir = updates_dir(app)?;
    let manifest_path = dir.join(PENDING_UPDATE_FILE);
    if manifest_path.exists() {
        let _ = fs::remove_file(&manifest_path);
    }
    if let Some(file_str) = staged_file {
        let candidate = PathBuf::from(file_str);
        if is_path_inside_updates_dir(&dir, &candidate) {
            let _ = fs::remove_file(candidate);
        }
    }
    Ok(())
}

/// Checks if a validated newer installer was downloaded in an earlier session.
/// On Windows, launches silent NSIS `/S` update + relaunches the updated app before exit.
pub fn apply_pending_update_on_startup(app: &AppHandle) -> bool {
    let Ok(dir) = updates_dir(app) else {
        return false;
    };
    let Some(record) = read_pending_record(app) else {
        return false;
    };

    let current_version = app.package_info().version.to_string();
    if !semver_gt(&record.version, &current_version) {
        let _ = clear_pending_update_files(app, Some(&record.file_path));
        return false;
    }

    let candidate = PathBuf::from(&record.file_path);
    if !is_path_inside_updates_dir(&dir, &candidate) {
        let _ = clear_pending_update_files(app, None);
        return false;
    }

    let mut header = [0u8; 4];
    let valid_magic = fs::File::open(&candidate)
        .and_then(|mut f| f.read(&mut header))
        .is_ok_and(|n| has_valid_binary_header(&record.file_name, &header[..n]));
    if !valid_magic {
        let _ = clear_pending_update_files(app, Some(&record.file_path));
        return false;
    }

    if let Some(expected_hash) = record.sha256.as_deref() {
        if verify_file_sha256(&candidate, Some(expected_hash)).is_err() {
            let _ = clear_pending_update_files(app, Some(&record.file_path));
            return false;
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Clear pending manifest before launching to guarantee no boot loop if interrupted
        if let Ok(manifest_path) = pending_manifest_path(app) {
            let _ = fs::remove_file(manifest_path);
        }

        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let path_str = candidate.to_string_lossy().to_string();
        let lower = path_str.to_ascii_lowercase();
        let escaped_installer = path_str.replace('\'', "''");
        let current_exe_relaunch = std::env::current_exe()
            .ok()
            .map(|exe| exe.to_string_lossy().to_string().replace('\'', "''"))
            .unwrap_or_default();

        let relaunch_stmt = if !current_exe_relaunch.is_empty() {
            format!("; if (Test-Path '{current_exe_relaunch}') {{ Start-Process -FilePath '{current_exe_relaunch}' }}")
        } else {
            String::new()
        };

        let ps_script = if lower.ends_with(".exe") {
            format!(
                "Start-Sleep -Milliseconds 450; Start-Process -FilePath '{escaped_installer}' -ArgumentList '/S' -Wait{relaunch_stmt}"
            )
        } else if lower.ends_with(".msi") {
            format!(
                "Start-Sleep -Milliseconds 450; Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i','{escaped_installer}','/qn','/norestart' -Wait{relaunch_stmt}"
            )
        } else {
            return false;
        };

        if std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &ps_script,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .is_ok()
        {
            return true;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Android / Linux / macOS keep pending_update.json intact so frontend/Android handler can trigger on launch
        let _ = candidate;
    }

    false
}

#[tauri::command]
pub async fn stage_silent_update(
    app: AppHandle,
    url: String,
    file_name: String,
    version: Option<String>,
    tag: Option<String>,
    expected_sha256: Option<String>,
) -> Result<StagedUpdateInfo, String> {
    if !is_allowed_release_url(&url) {
        return Err("Update URL is not in the allowlisted SupremeAI release origin.".to_string());
    }
    let clean_name = sanitize_file_name(&file_name)?;
    let expected_hash = normalize_sha256_hex(expected_sha256.as_deref())?;
    let resolved_version = version
        .as_deref()
        .map(|v| v.trim().trim_start_matches(['v', 'V']).to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| extract_version_hint(&clean_name, &app.package_info().version.to_string()));
    let resolved_tag = tag
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .unwrap_or("latest")
        .to_string();

    let dir = updates_dir(&app)?;
    let final_path = dir.join(&clean_name);

    if let Ok(meta) = fs::metadata(&final_path) {
        if meta.len() >= MIN_BINARY_BYTES && meta.len() <= MAX_BINARY_BYTES {
            if let Ok(mut f) = fs::File::open(&final_path) {
                let mut header = [0u8; 4];
                if let Ok(n) = f.read(&mut header) {
                    if has_valid_binary_header(&clean_name, &header[..n]) {
                        if let Ok(actual_sha256) =
                            verify_file_sha256(&final_path, expected_hash.as_deref())
                        {
                            let path_str = final_path.to_string_lossy().to_string();
                            persist_pending_record(
                                &app,
                                &PendingUpdateRecord {
                                    version: resolved_version.clone(),
                                    tag: resolved_tag,
                                    file_path: path_str.clone(),
                                    file_name: clean_name.clone(),
                                    url: url.trim().to_string(),
                                    staged_at: now_epoch_string(),
                                    sha256: Some(actual_sha256.clone()),
                                },
                            );
                            return Ok(StagedUpdateInfo {
                                file_path: path_str,
                                file_name: clean_name,
                                version: resolved_version,
                                size_bytes: meta.len(),
                                already_cached: true,
                                pending_on_next_startup: true,
                                sha256: Some(actual_sha256),
                            });
                        }
                    }
                }
            }
        }
        let _ = fs::remove_file(&final_path);
    }

    let client = reqwest::Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(180))
        .user_agent("SupremeAI-Silent-Updater/2.5")
        .build()
        .map_err(|_| "Could not initialize HTTPS update client.".to_string())?;

    let response = client
        .get(url.trim())
        .send()
        .await
        .map_err(|err| format!("Failed to reach release mirror: {err}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Release download returned HTTP {}.",
            response.status().as_u16()
        ));
    }

    let part_path = dir.join(format!("{clean_name}.part"));
    let mut part_file =
        fs::File::create(&part_path).map_err(|err| format!("Failed to open cache file: {err}"))?;

    let mut stream = response.bytes_stream();
    let mut total_bytes: u64 = 0;
    let mut header_checked = false;
    let mut header_buf: Vec<u8> = Vec::with_capacity(4);

    while let Some(chunk_res) = stream.next().await {
        let chunk = match chunk_res {
            Ok(bytes) => bytes,
            Err(err) => {
                let _ = fs::remove_file(&part_path);
                return Err(format!("Background download interrupted: {err}"));
            }
        };

        if !header_checked {
            let needed = 4usize.saturating_sub(header_buf.len());
            header_buf.extend_from_slice(&chunk[..chunk.len().min(needed)]);
            if header_buf.len() >= 2 {
                if !has_valid_binary_header(&clean_name, &header_buf) {
                    let _ = fs::remove_file(&part_path);
                    return Err("Downloaded payload failed installer magic-byte check.".to_string());
                }
                header_checked = true;
            }
        }

        total_bytes = total_bytes.saturating_add(chunk.len() as u64);
        if total_bytes > MAX_BINARY_BYTES {
            let _ = fs::remove_file(&part_path);
            return Err("Downloaded installer exceeds maximum allowed package size.".to_string());
        }

        if let Err(err) = part_file.write_all(&chunk) {
            let _ = fs::remove_file(&part_path);
            return Err(format!("Failed writing update chunk: {err}"));
        }
    }

    drop(part_file);

    if total_bytes < MIN_BINARY_BYTES {
        let _ = fs::remove_file(&part_path);
        return Err("Downloaded installer is unexpectedly small or incomplete.".to_string());
    }

    let verified_sha256 = match verify_file_sha256(&part_path, expected_hash.as_deref()) {
        Ok(digest) => digest,
        Err(err) => {
            let _ = fs::remove_file(&part_path);
            return Err(err);
        }
    };

    if final_path.exists() {
        let _ = fs::remove_file(&final_path);
    }
    fs::rename(&part_path, &final_path)
        .map_err(|err| format!("Failed to finalize staged installer: {err}"))?;

    let path_str = final_path.to_string_lossy().to_string();
    persist_pending_record(
        &app,
        &PendingUpdateRecord {
            version: resolved_version.clone(),
            tag: resolved_tag,
            file_path: path_str.clone(),
            file_name: clean_name.clone(),
            url: url.trim().to_string(),
            staged_at: now_epoch_string(),
            sha256: Some(verified_sha256.clone()),
        },
    );

    Ok(StagedUpdateInfo {
        file_path: path_str,
        file_name: clean_name,
        version: resolved_version,
        size_bytes: total_bytes,
        already_cached: false,
        pending_on_next_startup: true,
        sha256: Some(verified_sha256),
    })
}

#[tauri::command]
pub async fn apply_staged_update(
    app: AppHandle,
    file_path: String,
) -> Result<ApplyUpdateResult, String> {
    let dir = updates_dir(&app)?;
    let candidate = PathBuf::from(file_path.trim());
    if !is_path_inside_updates_dir(&dir, &candidate) {
        return Err("Staged installer path is invalid or outside the updates cache.".to_string());
    }
    if let Some(record) = read_pending_record(&app) {
        if let Some(expected_hash) = record.sha256.as_deref() {
            if let Err(err) = verify_file_sha256(&candidate, Some(expected_hash)) {
                let _ = clear_pending_update_files(&app, Some(&record.file_path));
                return Err(err);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(manifest_path) = pending_manifest_path(&app) {
            let _ = fs::remove_file(manifest_path);
        }

        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let path_str = candidate.to_string_lossy().to_string();
        let lower = path_str.to_ascii_lowercase();
        let escaped_ps_path = path_str.replace('\'', "''");
        let current_exe_relaunch = std::env::current_exe()
            .ok()
            .map(|exe| exe.to_string_lossy().to_string().replace('\'', "''"))
            .unwrap_or_default();
        let relaunch_stmt = if !current_exe_relaunch.is_empty() {
            format!("; if (Test-Path '{current_exe_relaunch}') {{ Start-Process -FilePath '{current_exe_relaunch}' }}")
        } else {
            String::new()
        };

        let ps_script = if lower.ends_with(".exe") {
            format!(
                "Start-Sleep -Milliseconds 650; Start-Process -FilePath '{escaped_ps_path}' -ArgumentList '/S' -Wait{relaunch_stmt}"
            )
        } else if lower.ends_with(".msi") {
            format!(
                "Start-Sleep -Milliseconds 650; Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i','{escaped_ps_path}','/qn','/norestart' -Wait{relaunch_stmt}"
            )
        } else {
            return Err("Unsupported Windows update package type.".to_string());
        };

        std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &ps_script,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|err| format!("Could not launch silent Windows installer: {err}"))?;

        let app_handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(250));
            app_handle.exit(0);
        });

        return Ok(ApplyUpdateResult {
            launched: true,
            silent: true,
            mode: "nsis-silent".to_string(),
            message: "Applying cached silent update now. SupremeAI Desktop will relaunch automatically.".to_string(),
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let mode = if cfg!(target_os = "android") {
            "android-package"
        } else {
            "manual-package"
        };
        Ok(ApplyUpdateResult {
            launched: false,
            silent: false,
            mode: mode.to_string(),
            message: "Update package downloaded on device. Tap install to complete Android APK update.".to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        has_valid_binary_header, is_allowed_release_url, normalize_sha256_hex, sanitize_file_name,
        semver_gt,
    };

    #[test]
    fn allowlists_only_supremeai_origins() {
        assert!(is_allowed_release_url(
            "https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI.Desktop_2.5.0_x64-setup.exe"
        ));
        assert!(is_allowed_release_url(
            "https://supremeai-studio.pages.dev/downloads/app.apk"
        ));
        assert!(!is_allowed_release_url("https://evil.example.com/payload.exe"));
        assert!(!is_allowed_release_url("http://github.com/Supremeai-bd/test.exe"));
    }

    #[test]
    fn rejects_unsafe_file_names() {
        assert!(sanitize_file_name("SupremeAI.Desktop_2.5.0_x64-setup.exe").is_ok());
        assert!(sanitize_file_name("SupremeAI-Studio-app-universal-release.apk").is_ok());
        assert!(sanitize_file_name("../evil.exe").is_err());
        assert!(sanitize_file_name("sub/file.exe").is_err());
        assert!(sanitize_file_name("payload.ps1").is_err());
    }

    #[test]
    fn validates_installer_magic_bytes() {
        assert!(has_valid_binary_header("setup.exe", b"MZ\x90\x00"));
        assert!(!has_valid_binary_header("setup.exe", b"<htm"));
        assert!(has_valid_binary_header("app.apk", b"PK\x03\x04"));
        assert!(!has_valid_binary_header("app.apk", b"<!DO"));
    }

    #[test]
    fn compares_semver_versions_accurately() {
        assert!(semver_gt("2.5.1", "2.5.0"));
        assert!(semver_gt("v2.6.0", "2.5.9"));
        assert!(!semver_gt("2.5.0", "2.5.0"));
        assert!(!semver_gt("2.4.9", "2.5.0"));
    }

    #[test]
    fn validates_sha256_hex_format() {
        let valid = "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD";
        assert_eq!(
            normalize_sha256_hex(Some(valid)).unwrap().as_deref(),
            Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        );
        assert_eq!(normalize_sha256_hex(None).unwrap(), None);
        assert!(normalize_sha256_hex(Some("not-hex")).is_err());
    }
}
