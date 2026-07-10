// RainySteamRecord — Tauri backend
// Copyright (C) 2026 CATMIAOZHI
// Licensed under GPL-3.0. Portions based on SteamClip by Nastas95 (GPL-3.0).

mod clip;
mod config;
mod ffmpeg;
mod mpv;
mod process_job;
mod steam;
mod streaming;
mod update;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::Emitter;

pub struct AppState {
    pub config: Mutex<config::AppConfig>,
    pub game_ids: Mutex<std::collections::HashMap<String, String>>,
    pub conversion_cancelled: Arc<AtomicBool>,
}

#[tauri::command]
fn get_config(state: tauri::State<'_, AppState>) -> Result<config::AppConfig, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    Ok(config.clone())
}

#[tauri::command]
async fn save_config(
    userdata_path: Option<String>,
    export_path: Option<String>,
    theme: Option<String>,
    language: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let snapshot = {
        let mut config = state.config.lock().map_err(|e| e.to_string())?;
        if let Some(p) = userdata_path { config.userdata_path = Some(p); }
        if let Some(p) = export_path { config.export_path = p; }
        if let Some(t) = theme { config.theme = t; }
        if let Some(l) = language { config.language = l; }
        config.clone()
    };
    tokio::task::spawn_blocking(move || config::save_config(&snapshot))
        .await
        .map_err(|e| e.to_string())?
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
async fn list_clips(
    userdata_path: String,
    steam_id: String,
    media_type: String,
    use_cache: Option<bool>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<clip::ClipInfo>, String> {
    let game_ids_map = {
        let game_ids = state.game_ids.lock().map_err(|e| e.to_string())?;
        game_ids.clone()
    };
    let use_cache = use_cache.unwrap_or(true);
    tokio::task::spawn_blocking(move || {
        clip::list_clips(
            &userdata_path,
            &steam_id,
            &media_type,
            &game_ids_map,
            use_cache,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_clip_duration(clip_folder: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || clip::get_clip_duration(&clip_folder))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn generate_thumbnail(clip_folder: String) -> Result<Option<String>, String> {
    Ok(clip::generate_thumbnail(&clip_folder).await?)
}

#[tauri::command]
async fn regenerate_thumbnail(clip_folder: String) -> Result<Option<String>, String> {
    let thumbnail_path = std::path::Path::new(&clip_folder).join("thumbnail.jpg");
    tokio::task::spawn_blocking(move || {
        if thumbnail_path.exists() {
            std::fs::remove_file(thumbnail_path).map_err(|e| e.to_string())?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    clip::generate_thumbnail(&clip_folder).await
}

#[tauri::command]
async fn trash_clip(clip_folder: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let path = std::path::Path::new(&clip_folder);
        if !path.is_dir() {
            return Err("Clip folder does not exist".to_string());
        }
        trash::delete(path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn prepare_preview(clip_folder: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || ffmpeg::prepare_preview(&clip_folder))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_mpv_preview(
    clip_folder: String,
    title: String,
) -> Result<(), String> {
    mpv::open_preview(&clip_folder, &title)
}

#[tauri::command]
async fn cleanup_preview(preview_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || ffmpeg::cleanup_preview(&preview_path))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_clip_stream_info(clip_folder: String) -> Result<streaming::ClipStreamInfo, String> {
    tokio::task::spawn_blocking(move || streaming::get_clip_stream_info(&clip_folder))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read_segment_bytes(file_path: String) -> Result<tauri::ipc::Response, String> {
    let data = tokio::task::spawn_blocking(move || streaming::read_segment_bytes(&file_path))
        .await
        .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(data))
}

#[tauri::command]
fn get_game_ids(
    state: tauri::State<'_, AppState>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let game_ids = state.game_ids.lock().map_err(|e| e.to_string())?;
    Ok(game_ids.clone())
}

#[tauri::command]
async fn save_game_ids(
    game_ids: std::collections::HashMap<String, String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut current = state.game_ids.lock().map_err(|e| e.to_string())?;
        *current = game_ids.clone();
    }
    tokio::task::spawn_blocking(move || config::save_game_ids(&game_ids))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn fetch_game_name(game_id: String) -> Result<String, String> {
    Ok(steam::fetch_game_name(&game_id).await)
}

#[tauri::command]
async fn fetch_game_names_batch(
    game_ids: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let existing = state.game_ids.lock().map_err(|e| e.to_string())?.clone();
    let updated = steam::fetch_game_names_batch(&game_ids, &existing).await;
    {
        let mut current = state.game_ids.lock().map_err(|e| e.to_string())?;
        *current = updated.clone();
    }
    config::save_game_ids(&updated)?;
    Ok(updated)
}

#[tauri::command]
async fn merge_non_steam_games(
    userdata_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let non_steam = tokio::task::spawn_blocking(move || steam::load_non_steam_games(&userdata_path))
        .await
        .map_err(|e| e.to_string())??;
    let (result, merged) = {
        let mut game_ids = state.game_ids.lock().map_err(|e| e.to_string())?;
        let mut merged = 0;
        for (app_id, app_name) in &non_steam {
            if !game_ids.contains_key(app_id) || game_ids.get(app_id) == Some(app_id) {
                game_ids.insert(app_id.clone(), app_name.clone());
                merged += 1;
            }
        }
        (game_ids.clone(), merged)
    };
    if merged > 0 {
        let snapshot = result.clone();
        tokio::task::spawn_blocking(move || config::save_game_ids(&snapshot))
            .await
            .map_err(|e| e.to_string())??;
    }
    Ok(result)
}

#[tauri::command]
async fn convert_clips(
    clip_folders: Vec<String>,
    export_dir: String,
    game_ids: std::collections::HashMap<String, String>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    state.conversion_cancelled.store(false, Ordering::Release);
    let total = clip_folders.len();
    let mut errors = false;
    let mut completed = 0;
    for (idx, clip_folder) in clip_folders.iter().enumerate() {
        if state.conversion_cancelled.load(Ordering::Acquire) { break; }
        let _ = app_handle.emit(
            "conversion-progress",
            serde_json::json!({
                "current": idx + 1,
                "total": total,
                "percent": ((idx as f64) / (total as f64) * 100.0) as i32,
                "message": format!("Processing clip {}/{}", idx + 1, total),
            }),
        );
        match ffmpeg::convert_single_clip(
            clip_folder,
            &export_dir,
            &game_ids,
            state.conversion_cancelled.clone(),
        ).await {
            Ok(_) => { completed += 1; }
            Err(e) => {
                log::error!("Failed to convert clip {}: {}", clip_folder, e);
                errors = true;
            }
        }
    }
    let cancelled = state.conversion_cancelled.load(Ordering::Acquire);
    let _ = app_handle.emit("conversion-done", serde_json::json!({
        "success": !errors && !cancelled,
        "cancelled": cancelled,
        "completed": completed,
        "total": total,
        "message": if cancelled { "Conversion cancelled" } else if !errors { "All clips converted successfully" } else { "Some clips failed to convert" },
    }));
    Ok(!errors)
}

#[tauri::command]
fn cancel_conversion(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.conversion_cancelled.store(true, Ordering::Release);
    Ok(())
}

#[tauri::command]
async fn check_for_updates() -> Result<update::ReleaseInfo, String> {
    Ok(update::check_latest_release().await?)
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer")
            .arg(&path)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
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
            conversion_cancelled: Arc::new(AtomicBool::new(false)),
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
            regenerate_thumbnail,
            trash_clip,
            prepare_preview,
            open_mpv_preview,
            cleanup_preview,
            get_clip_stream_info,
            read_segment_bytes,
            get_game_ids,
            save_game_ids,
            fetch_game_name,
            fetch_game_names_batch,
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
