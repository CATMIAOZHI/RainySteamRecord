// RainySteamRecord — Config management
// Copyright (C) 2026 CATMIAOZHI
// Licensed under GPL-3.0.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub schema_version: u32,
    pub userdata_path: Option<String>,
    pub export_path: String,
    pub theme: String,
    pub language: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        let desktop = dirs::desktop_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| {
                let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users".to_string());
                format!("{}\\Desktop", home)
            });
        Self {
            schema_version: 1,
            userdata_path: None,
            export_path: desktop,
            theme: "rainy".to_string(),
            language: "zh-CN".to_string(),
        }
    }
}

fn config_dir() -> PathBuf {
    let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
        std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users".to_string())
    });
    PathBuf::from(local_appdata).join("RainySteamRecord")
}

fn config_file() -> PathBuf {
    config_dir().join("config.json")
}

fn game_ids_file() -> PathBuf {
    config_dir().join("GameIDs.json")
}

fn atomic_write_json<T: serde::Serialize>(path: &std::path::Path, data: &T) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| "No parent directory".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    let file_name = path.file_name().ok_or_else(|| "No file name".to_string())?;
    let temp_name = format!(
        "{}.tmp.{}",
        file_name.to_string_lossy(),
        uuid::Uuid::new_v4()
    );
    let temp_path = dir.join(temp_name);

    let write_result = (|| -> Result<(), String> {
        let file = std::fs::File::create(&temp_path).map_err(|e| e.to_string())?;
        let mut writer = std::io::BufWriter::new(file);
        serde_json::to_writer_pretty(&mut writer, data).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        writer.get_ref().sync_all().map_err(|e| e.to_string())
    })();
    if let Err(error) = write_result {
        let _ = std::fs::remove_file(&temp_path);
        return Err(error);
    }

    replace_file(&temp_path, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&temp_path);
    })?;

    Ok(())
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    std::fs::rename(source, destination).map_err(|e| e.to_string())
}

fn preserve_corrupt_file(path: &Path) -> Result<PathBuf, String> {
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let uuid_suffix = uuid::Uuid::new_v4();
    let corrupt_path = path.with_extension(format!("corrupt-{}-{}.json", timestamp, uuid_suffix));
    std::fs::rename(path, &corrupt_path).map_err(|e| {
        format!(
            "Failed to preserve corrupt {}: {}",
            path.file_name().unwrap_or_default().to_string_lossy(),
            e
        )
    })?;
    Ok(corrupt_path)
}

fn normalize_path(path: &str) -> String {
    let path = path.trim();
    if path.is_empty() {
        return String::new();
    }
    let mut normalized = path.replace('/', "\\");
    let chars: Vec<char> = normalized.chars().collect();
    if chars.len() >= 2 && chars[1] == ':' {
        let first = chars[0];
        if first.is_ascii_alphabetic() && first.is_ascii_lowercase() {
            let upper = first.to_ascii_uppercase();
            normalized = format!("{}{}", upper, &normalized[1..]);
        }
    }
    normalized
}

pub fn load_config() -> Result<AppConfig, String> {
    let path = config_file();
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read config file: {}", e))?;
    match serde_json::from_str::<AppConfig>(&content) {
        Ok(mut config) => {
            if config.schema_version == 0 {
                config.schema_version = 1;
            }
            config.userdata_path = config.userdata_path.map(|p| normalize_path(&p));
            config.export_path = normalize_path(&config.export_path);
            Ok(config)
        }
        Err(e) => {
            let corrupt_path = preserve_corrupt_file(&path)?;
            Err(format!(
                "Failed to parse config file: {}. Corrupt file backed up to {}",
                e,
                corrupt_path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
            ))
        }
    }
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let mut normalized = config.clone();
    normalized.userdata_path = normalized.userdata_path.map(|p| normalize_path(&p));
    normalized.export_path = normalize_path(&normalized.export_path);
    atomic_write_json(&config_file(), &normalized)
}

pub fn load_game_ids() -> Result<HashMap<String, String>, String> {
    let path = game_ids_file();
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read GameIDs.json: {}", e))?;
    match serde_json::from_str::<HashMap<String, String>>(&content) {
        Ok(map) => Ok(map),
        Err(e) => {
            let corrupt_path = preserve_corrupt_file(&path)?;
            Err(format!(
                "Failed to parse GameIDs.json: {}. Corrupt file backed up to {}",
                e,
                corrupt_path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
            ))
        }
    }
}

pub fn save_game_ids(game_ids: &HashMap<String, String>) -> Result<(), String> {
    atomic_write_json(&game_ids_file(), game_ids)
}

#[allow(dead_code)]
pub fn get_game_ids_file() -> PathBuf {
    game_ids_file()
}

pub fn get_config_dir() -> PathBuf {
    config_dir()
}

mod dirs {
    pub fn desktop_dir() -> Option<std::path::PathBuf> {
        std::env::var("USERPROFILE")
            .ok()
            .map(|home| std::path::PathBuf::from(home).join("Desktop"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config_theme() {
        let default_config = AppConfig::default();
        assert_eq!(default_config.theme, "rainy");
        assert_eq!(default_config.schema_version, 1);
    }

    #[test]
    fn test_atomic_write_and_corrupt_backup() {
        let temp_dir = std::env::temp_dir().join(format!("rainy_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let config_path = temp_dir.join("config.json");
        let config = AppConfig {
            schema_version: 2,
            userdata_path: Some("path".to_string()),
            export_path: "export".to_string(),
            theme: "dark".to_string(),
            language: "en-US".to_string(),
        };
        atomic_write_json(&config_path, &config).unwrap();
        assert!(config_path.exists());
        let content = std::fs::read_to_string(&config_path).unwrap();
        let loaded: AppConfig = serde_json::from_str(&content).unwrap();
        assert_eq!(loaded.schema_version, 2);
        assert_eq!(loaded.theme, "dark");

        let updated = AppConfig {
            theme: "rainy".to_string(),
            ..config
        };
        atomic_write_json(&config_path, &updated).unwrap();
        let loaded: AppConfig =
            serde_json::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
        assert_eq!(loaded.theme, "rainy");

        std::fs::write(&config_path, "{ invalid json").unwrap();
        let corrupt_path = preserve_corrupt_file(&config_path).unwrap();
        assert!(corrupt_path.exists());
        assert!(!config_path.exists());
        std::fs::remove_dir_all(&temp_dir).unwrap();
    }
}
