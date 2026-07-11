// RainySteamRecord — Config management
// Copyright (C) 2026 CATMIAOZHI
// Licensed under GPL-3.0.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
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
            userdata_path: None,
            export_path: desktop,
            theme: "Steam Dark".to_string(),
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

pub fn load_config() -> Result<AppConfig, String> {
    let path = config_file();
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str::<AppConfig>(&content).map_err(|e| e.to_string())
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(config_file(), content).map_err(|e| e.to_string())
}

pub fn load_game_ids() -> Result<HashMap<String, String>, String> {
    let path = game_ids_file();
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str::<HashMap<String, String>>(&content).map_err(|e| e.to_string())
}

pub fn save_game_ids(game_ids: &HashMap<String, String>) -> Result<(), String> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(game_ids).map_err(|e| e.to_string())?;
    std::fs::write(game_ids_file(), content).map_err(|e| e.to_string())
}

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
