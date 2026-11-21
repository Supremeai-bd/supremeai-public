use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const VAULT_MAGIC: &[u8; 5] = b"SAIV1";
const VAULT_SALT_FILE: &str = ".vault_salt";
const NONCE_LEN: usize = 12;

pub fn write_restricted_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut file = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(bytes)?;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
        Ok(())
    }
    #[cfg(not(unix))]
    {
        fs::write(path, bytes)
    }
}

pub fn config_dir_file(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join(name))
}

fn load_or_create_salt(app: &AppHandle) -> Result<[u8; 32], String> {
    let salt_path = config_dir_file(app, VAULT_SALT_FILE)
        .ok_or_else(|| "Could not resolve secure vault directory.".to_string())?;
    if let Ok(existing) = fs::read(&salt_path) {
        if existing.len() == 32 {
            let mut out = [0u8; 32];
            out.copy_from_slice(&existing);
            return Ok(out);
        }
    }
    let mut salt = [0u8; 32];
    OsRng.fill_bytes(&mut salt);
    write_restricted_file(&salt_path, &salt)
        .map_err(|_| "Could not initialize secure vault salt.".to_string())?;
    Ok(salt)
}

pub fn derive_vault_key(salt: &[u8; 32], identifier: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"SupremeAI-Vault-v1:");
    hasher.update(identifier.as_bytes());
    hasher.update(b":");
    hasher.update(std::env::consts::OS.as_bytes());
    hasher.update(b":");
    hasher.update(std::env::consts::ARCH.as_bytes());
    hasher.update(b":");
    hasher.update(salt);
    let digest = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&digest);
    key
}

pub fn seal_bytes(key_bytes: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(key);
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| "Failed to encrypt secure payload.".to_string())?;

    let mut out = Vec::with_capacity(VAULT_MAGIC.len() + NONCE_LEN + ciphertext.len());
    out.extend_from_slice(VAULT_MAGIC);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn open_bytes(key_bytes: &[u8; 32], stored: &[u8]) -> Result<Vec<u8>, String> {
    if stored.len() < VAULT_MAGIC.len() + NONCE_LEN + 16 || &stored[..VAULT_MAGIC.len()] != VAULT_MAGIC {
        return Err("Stored payload is not a valid sealed vault record.".to_string());
    }
    let nonce_start = VAULT_MAGIC.len();
    let cipher_start = nonce_start + NONCE_LEN;
    let key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&stored[nonce_start..cipher_start]);
    cipher
        .decrypt(nonce, &stored[cipher_start..])
        .map_err(|_| "Failed to decrypt secure payload.".to_string())
}

fn app_vault_key(app: &AppHandle) -> Result<[u8; 32], String> {
    let salt = load_or_create_salt(app)?;
    let identifier = app.config().identifier.as_str();
    Ok(derive_vault_key(&salt, identifier))
}

pub fn write_encrypted_json<T: Serialize>(
    app: &AppHandle,
    file_name: &str,
    value: &T,
) -> Result<(), String> {
    let path = config_dir_file(app, file_name)
        .ok_or_else(|| "The secure store location could not be resolved.".to_string())?;
    let json_bytes =
        serde_json::to_vec(value).map_err(|_| "Secure record could not be encoded.".to_string())?;
    let key = app_vault_key(app)?;
    let sealed = seal_bytes(&key, &json_bytes)?;
    write_restricted_file(&path, &sealed)
        .map_err(|_| "The secure store could not be saved.".to_string())
}

pub fn read_encrypted_json_or_migrate<T: Serialize + DeserializeOwned>(
    app: &AppHandle,
    file_name: &str,
) -> Option<T> {
    let path = config_dir_file(app, file_name)?;
    let bytes = fs::read(&path).ok()?;
    if bytes.starts_with(VAULT_MAGIC) {
        let key = app_vault_key(app).ok()?;
        let decrypted = open_bytes(&key, &bytes).ok()?;
        return serde_json::from_slice::<T>(&decrypted).ok();
    }
    // Transparent one-time migration from legacy plaintext JSON to AES-256-GCM sealed storage
    let legacy: T = serde_json::from_slice(&bytes).ok()?;
    let _ = write_encrypted_json(app, file_name, &legacy);
    Some(legacy)
}

pub fn sha256_hex_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn sha256_hex_file(path: &Path) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|err| format!("Failed opening file for checksum: {err}"))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|err| format!("Failed reading file for checksum: {err}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    Ok(digest.iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::{derive_vault_key, open_bytes, seal_bytes, sha256_hex_bytes};

    #[test]
    fn roundtrips_aes_gcm_sealed_payload() {
        let salt = [7u8; 32];
        let key = derive_vault_key(&salt, "com.supremeai.desktop");
        let plaintext = br#"{"access_token":"tok_123","email":"user@supremeai.dev"}"#;

        let sealed = seal_bytes(&key, plaintext).expect("seal must succeed");
        assert_ne!(&sealed[..], plaintext);
        assert!(sealed.starts_with(b"SAIV1"));

        let opened = open_bytes(&key, &sealed).expect("open must succeed");
        assert_eq!(opened, plaintext);
    }

    #[test]
    fn rejects_tampered_ciphertext() {
        let salt = [9u8; 32];
        let key = derive_vault_key(&salt, "com.supremeai.desktop");
        let mut sealed = seal_bytes(&key, b"secret-token").expect("seal");
        let last = sealed.len() - 1;
        sealed[last] ^= 0xFF;
        assert!(open_bytes(&key, &sealed).is_err());
    }

    #[test]
    fn computes_standard_sha256_hex() {
        assert_eq!(
            sha256_hex_bytes(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
