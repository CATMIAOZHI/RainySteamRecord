// RainySteamRecord — Tauri backend
// Copyright (C) 2026 CATMIAOZHI
// Licensed under GPL-3.0. Portions based on SteamClip by Nastas95 (GPL-3.0).

mod config;
mod steam;
mod ffmpeg;
mod clip;
mod update;

use std::sync::Mutex;
use tauri::Emitter;

pub struct AppState {
    pub config: Mutex<config::AppConfig>,
    pub game_ids: Mutex<std::collections::HashMap<String, String>>,
    pub conversion_cancelled: Mutex<bool>,
}

#[tauri::command]
fn get_config(state: tauri::State<'_, AppState>) -> Result<config::AppConfig, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    Ok(config.clone())
}

#[tauri::command]
fn save_config(
    userdata_path: Option<String>,
    export_path: Option<String>,
    theme: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    if let Some(p) = userdata_path { config.userdata_path = Some(p); }
    if let Some(p) = export_path { config.export_path = p; }
    if let Some(t) = theme { config.theme = t; }
    config::save_config(&config)?;
    Ok(())
}

#[tauri::command]
fn find_steam_userdata() -> Result<Option<String>, String> {
    Ok(steam::find_steam_userdata())
}

#[tauri::command]
fn validate_userdata(folder: String) -> Result<bool, String> {
    Ok(steam::validate_userdata(&folder))
}

#[tauri::command]
fn list_steam_ids(userdata_path: String) -> Result<Vec<String>, String> {
    Ok(steam::list_steam_ids(&userdata_path)?)
}

#[tauri::command]
fn list_clips(
    userdata_path: String,
    steam_id: String,
    media_type: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<clip::ClipInfo>, String> {
    let game_ids = state.game_ids.lock().map_err(|e| e.to_string())?;
    let game_ids_map: std::collections::HashMap<String, String> = game_ids.clone();
    drop(game_ids);
    Ok(clip::list_clips(&userdata_path, &steam_id, &media_type, &game_ids_map)?)
}

#[tauri::command]
fn get_clip_duration(clip_folder: String) -> Result<String, String> {
    Ok(clip::get_clip_duration(&clip_folder)?)
}

#[tauri::command]
async fn generate_thumbnail(clip_folder: String) -> Result<Option<String>, String> {
    Ok(clip::generate_thumbnail(&clip_folder).await?)
}

#[tauri::command]
async fn prepare_preview(clip_folder: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        ffmpeg::prepare_preview(&clip_folder)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cleanup_preview(preview_path: String) {
    ffmpeg::cleanup_preview(&preview_path);
}

#[tauri::command]
fn get_game_ids(state: tauri::State<'_, AppState>) -> Result<std::collections::HashMap<String, String>, String> {
    let game_ids = state.game_ids.lock().map_err(|e| e.to_string())?;
    Ok(game_ids.clone())
}

#[tauri::command]
fn save_game_ids(
    game_ids: std::collections::HashMap<String, String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut current = state.game_ids.lock().map_err(|e| e.to_string())?;
    *current = game_ids.clone();
    config::save_game_ids(&game_ids)?;
    Ok(())
}

#[tauri::command]
async fn fetch_game_name(game_id: String) -> Result<String, String> {
    Ok(steam::fetch_game_name(&game_id).await)
}

#[tauri::command]
async fn merge_non_steam_games(
    userdata_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let non_steam = steam::load_non_steam_games(&userdata_path)?;
    let mut game_ids = state.game_ids.lock().map_err(|e| e.to_string())?;
    let mut merged = 0;
    for (app_id, app_name) in &non_steam {
        if !game_ids.contains_key(app_id) || game_ids.get(app_id) == Some(app_id) {
            game_ids.insert(app_id.clone(), app_name.clone());
            merged += 1;
        }
    }
    if merged > 0 {
        config::save_game_ids(&game_ids.clone())?;
    }
    Ok(game_ids.clone())
}

#[tauri::command]
async fn convert_clips(
    clip_folders: Vec<String>,
    export_dir: String,
    game_ids: std::collections::HashMap<String, String>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    {
        let mut cancelled = state.conversion_cancelled.lock().map_err(|e| e.to_string())?;
        *cancelled = false;
    }
    let total = clip_folders.len();
    let mut errors = false;
    for (idx, clip_folder) in clip_folders.iter().enumerate() {
        {
            let cancelled = state.conversion_cancelled.lock().map_err(|e| e.to_string())?;
            if *cancelled { break; }
        }
        let _ = app_handle.emit("conversion-progress", serde_json::json!({
            "current": idx + 1,
            "total": total,
            "percent": ((idx as f64) / (total as f64) * 100.0) as i32,
            "message": format!("Processing clip {}/{}", idx + 1, total),
        }));
        match ffmpeg::convert_single_clip(clip_folder, &export_dir, &game_ids).await {
            Ok(_) => {}
            Err(e) => {
                log::error!("Failed to convert clip {}: {}", clip_folder, e);
                errors = true;
            }
        }
    }
    let _ = app_handle.emit("conversion-done", serde_json::json!({
        "success": !errors,
        "message": if !errors { "All clips converted successfully" } else { "Some clips failed to convert" },
    }));
    Ok(!errors)
}

#[tauri::command]
fn cancel_conversion(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut cancelled = state.conversion_cancelled.lock().map_err(|e| e.to_string())?;
    *cancelled = true;
    Ok(())
}

#[tauri::command]
async fn check_for_updates() -> Result<update::ReleaseInfo, String> {
    Ok(update::check_latest_release().await?)
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    std::process::Command::new("explorer").arg(&path).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_config_dir() -> Result<String, String> {
    Ok(config::get_config_dir().to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let config = config::load_config().unwrap_or_default();
    let game_ids = config::load_game_ids().unwrap_or_default();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            config: Mutex::new(config),
            game_ids: Mutex::new(game_ids),
            conversion_cancelled: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            find_steam_userdata,
            validate_userdata,
            list_steam_ids,
            list_clips,
            get_clip_duration,
            generate_thumbnail,
            prepare_preview,
            cleanup_preview,
            get_game_ids,
            save_game_ids,
            fetch_game_name,
            merge_non_steam_games,
            convert_clips,
            cancel_conversion,
            check_for_updates,
            open_folder,
            get_config_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}