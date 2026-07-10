// RainySteamRecord — Steam discovery, VDF parser, non-Steam games
// Copyright (C) 2026 CATMIAOZHI
// Licensed under GPL-3.0. Portions based on SteamClip by Nastas95 (GPL-3.0).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub fn find_steam_userdata() -> Option<String> {
    let candidates: Vec<PathBuf> = vec![
        PathBuf::from(r"C:\Program Files (x86)\Steam\userdata"),
        PathBuf::from(r"C:\Program Files\Steam\userdata"),
    ];
    for path in &candidates {
        if path.exists() && path.is_dir() {
            return Some(path.to_string_lossy().to_string());
        }
    }
    None
}

pub fn validate_userdata(folder: &str) -> bool {
    let path = Path::new(folder);
    if !path.is_dir() {
        return false;
    }
    let basename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if basename != "userdata" {
        return false;
    }
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.chars().all(|c| c.is_ascii_digit()) {
                    let local_vdf = entry.path().join("config").join("localconfig.vdf");
                    if local_vdf.is_file() {
                        return true;
                    }
                }
            }
        }
    }
    false
}

pub fn list_steam_ids(userdata_path: &str) -> Result<Vec<String>, String> {
    let path = Path::new(userdata_path);
    if !path.is_dir() {
        return Err("Userdata directory not found".to_string());
    }
    let mut ids = Vec::new();
    let entries = std::fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if entry.path().is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.chars().all(|c| c.is_ascii_digit()) {
                let local_vdf = entry.path().join("config").join("localconfig.vdf");
                if local_vdf.is_file() {
                    ids.push(name);
                }
            }
        }
    }
    Ok(ids)
}

pub fn find_steam_root(userdata_path: &str) -> Option<PathBuf> {
    let p = Path::new(userdata_path);
    if !p.is_dir() {
        return None;
    }
    let steam_root = p.parent().and_then(|p| p.parent())?;
    if steam_root.join("userdata").exists() {
        return Some(steam_root.to_path_buf());
    }
    None
}

pub fn get_custom_record_path(userdata_dir: &str) -> Option<String> {
    let localconfig_path = Path::new(userdata_dir)
        .join("config")
        .join("localconfig.vdf");
    if !localconfig_path.is_file() {
        return None;
    }
    let content = std::fs::read_to_string(&localconfig_path).ok()?;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.contains("\"BackgroundRecordPath\"") {
            let parts: Vec<&str> = trimmed.splitn(2, "\"BackgroundRecordPath\"").collect();
            if parts.len() > 1 {
                let path_part = parts[1].trim().trim_matches('"').trim();
                if !path_part.is_empty() {
                    return Some(path_part.replace("\\\\", "\\"));
                }
            }
        }
    }
    None
}

pub fn load_non_steam_games(userdata_path: &str) -> Result<HashMap<String, String>, String> {
    let mut non_steam_games = HashMap::new();
    let steam_root = match find_steam_root(userdata_path) {
        Some(r) => r,
        None => return Ok(non_steam_games),
    };
    let userdata_dir = steam_root.join("userdata");
    if !userdata_dir.is_dir() {
        return Ok(non_steam_games);
    }
    let entries = std::fs::read_dir(&userdata_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let shortcuts_path = entry.path().join("config").join("shortcuts.vdf");
        if !shortcuts_path.is_file() {
            continue;
        }
        let data = match std::fs::read(&shortcuts_path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let items = parse_binary_vdf(&data);
        for item in items {
            let app_name = get_case_insensitive(&item, "appname").unwrap_or_default();
            let exe_path = get_case_insensitive(&item, "exe").unwrap_or_default();
            let app_name = app_name.trim();
            if app_name.is_empty() {
                continue;
            }
            let raw_id = get_case_insensitive(&item, "appid");
            if let Some(raw) = raw_id {
                if let Ok(app_id_32) = raw.parse::<u32>() {
                    let clip_id = ((app_id_32 as u64) << 32) | 0x02000000;
                    non_steam_games.insert(clip_id.to_string(), app_name.to_string());
                    continue;
                }
            }
            if !exe_path.is_empty() {
                let crc_input = format!("{}{}", exe_path, app_name);
                let crc = crc32fast::hash(crc_input.as_bytes());
                let app_id_32 = crc | 0x80000000;
                let clip_id = ((app_id_32 as u64) << 32) | 0x02000000;
                non_steam_games.insert(clip_id.to_string(), app_name.to_string());

                if !exe_path.starts_with('"') {
                    let crc_input_q = format!("\"{}\"{}", exe_path, app_name);
                    let crc_q = crc32fast::hash(crc_input_q.as_bytes());
                    let app_id_32_q = crc_q | 0x80000000;
                    let clip_id_q = ((app_id_32_q as u64) << 32) | 0x02000000;
                    non_steam_games.insert(clip_id_q.to_string(), app_name.to_string());
                }
            }
        }
    }
    Ok(non_steam_games)
}

fn get_case_insensitive(map: &HashMap<String, VdfValue>, key: &str) -> Option<String> {
    let key_lower = key.to_lowercase();
    for (k, v) in map {
        if k.to_lowercase() == key_lower {
            if let VdfValue::String(s) = v {
                return Some(s.clone());
            }
        }
    }
    None
}

#[derive(Debug, Clone)]
pub enum VdfValue {
    String(String),
    Int(u32),
    Map(HashMap<String, VdfValue>),
}

pub fn parse_binary_vdf(data: &[u8]) -> Vec<HashMap<String, VdfValue>> {
    let mut items = Vec::new();
    if data.is_empty() {
        return items;
    }
    let mut ptr = 0usize;
    if data[ptr] == 0x00 {
        ptr += 1;
    }
    if let Ok((key, new_ptr)) = read_string(data, ptr) {
        if key.to_lowercase() == "shortcuts" {
            if let Ok((root_map, _)) = parse_map(data, new_ptr) {
                for (_, v) in root_map {
                    if let VdfValue::Map(m) = v {
                        items.push(m);
                    }
                }
                return items;
            }
        }
    }
    if let Ok((root_map, _)) = parse_map(data, 0) {
        for (_, v) in root_map {
            if let VdfValue::Map(m) = v {
                items.push(m);
            }
        }
    }
    items
}

fn read_string(data: &[u8], pos: usize) -> Result<(String, usize), String> {
    let end = data
        .iter()
        .skip(pos)
        .position(|&b| b == 0x00)
        .ok_or("Unterminated string")?;
    let end_abs = pos + end;
    let s = String::from_utf8_lossy(&data[pos..end_abs]).to_string();
    Ok((s, end_abs + 1))
}

fn parse_map(data: &[u8], mut pos: usize) -> Result<(HashMap<String, VdfValue>, usize), String> {
    let mut result = HashMap::new();
    while pos < data.len() {
        let type_byte = data[pos];
        pos += 1;
        if type_byte == 0x08 {
            return Ok((result, pos));
        }
        if pos >= data.len() {
            break;
        }
        let (key, new_pos) = read_string(data, pos)?;
        pos = new_pos;

        match type_byte {
            0x00 => {
                let (sub_map, new_pos) = parse_map(data, pos)?;
                pos = new_pos;
                result.insert(key, VdfValue::Map(sub_map));
            }
            0x01 => {
                let (val, new_pos) = read_string(data, pos)?;
                pos = new_pos;
                result.insert(key, VdfValue::String(val));
            }
            0x02 => {
                if pos + 4 > data.len() {
                    break;
                }
                let val =
                    u32::from_le_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]);
                pos += 4;
                result.insert(key, VdfValue::Int(val));
            }
            0x03 => {
                pos += 4;
            }
            0x07 => {
                pos += 8;
            }
            _ => break,
        }
    }
    Ok((result, pos))
}

pub async fn fetch_game_name(game_id: &str) -> String {
    if !game_id.chars().all(|c| c.is_ascii_digit()) {
        return game_id.to_string();
    }
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}&filters=basic",
        game_id
    );
    let client = reqwest::Client::builder()
        .user_agent("RainySteamRecord/0.1.1")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    match client.get(&url).send().await {
        Ok(resp) => {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                if let Some(data) = json.get(game_id) {
                    if data
                        .get("success")
                        .and_then(|s| s.as_bool())
                        .unwrap_or(false)
                    {
                        if let Some(name) = data
                            .get("data")
                            .and_then(|d| d.get("name"))
                            .and_then(|n| n.as_str())
                        {
                            return name.to_string();
                        }
                    }
                }
            }
        }
        Err(_) => {}
    }
    game_id.to_string()
}

pub async fn fetch_game_names_batch(
    game_ids: &[String],
    existing: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut result = existing.clone();
    let client = reqwest::Client::builder()
        .user_agent("RainySteamRecord/0.1.1")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    for game_id in game_ids {
        if result.contains_key(game_id) {
            continue;
        }
        if !game_id.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let url = format!(
            "https://store.steampowered.com/api/appdetails?appids={}&filters=basic",
            game_id
        );
        if let Ok(resp) = client.get(&url).send().await {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                if let Some(data) = json.get(game_id.as_str()) {
                    if data
                        .get("success")
                        .and_then(|s| s.as_bool())
                        .unwrap_or(false)
                    {
                        if let Some(name) = data
                            .get("data")
                            .and_then(|d| d.get("name"))
                            .and_then(|n| n.as_str())
                        {
                            result.insert(game_id.clone(), name.to_string());
                        }
                    }
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }
    result
}
