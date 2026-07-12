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

use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::Emitter;

struct ConversionJob {
    job_id: String,
    cancelled: Arc<AtomicBool>,
}

pub struct AppState {
    pub config: Mutex<config::AppConfig>,
    pub config_error: Mutex<Option<String>>,
    config_save_lock: tokio::sync::Mutex<()>,
    pub game_ids: Mutex<std::collections::HashMap<String, String>>,
    game_ids_save_lock: tokio::sync::Mutex<()>,
    conversion_job: Mutex<Option<ConversionJob>>,
}

#[derive(Debug, Serialize)]
struct BatchItemSuccess {
    clip_folder: String,
    output_path: Option<String>,
}

#[derive(Debug, Serialize)]
struct BatchItemFailure {
    clip_folder: String,
    error: String,
}

#[derive(Debug, Serialize)]
struct BatchResult {
    succeeded: Vec<BatchItemSuccess>,
    failed: Vec<BatchItemFailure>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ConversionEvent {
    JobStarted {
        job_id: String,
        total: usize,
    },
    ItemStarted {
        job_id: String,
        index: usize,
        clip_folder: String,
    },
    ItemSucceeded {
        job_id: String,
        index: usize,
        clip_folder: String,
        output_path: String,
    },
    ItemFailed {
        job_id: String,
        index: usize,
        clip_folder: String,
        error: String,
    },
    JobFinished {
        job_id: String,
        status: String,
        total: usize,
        succeeded: usize,
        failed: usize,
    },
}

fn emit_conversion(app: &tauri::AppHandle, event: ConversionEvent) {
    if let Err(error) = app.emit("conversion-event", event) {
        log::warn!("Failed to emit conversion event: {}", error);
    }
}

#[tauri::command]
fn get_config(state: tauri::State<'_, AppState>) -> Result<config::AppConfig, String> {
    let has_config_error = state
        .config_error
        .lock()
        .map_err(|e| e.to_string())?
        .is_some();
    if has_config_error {
        let _guard = state.config_save_lock.blocking_lock();
        let still_has_error = state
            .config_error
            .lock()
            .map_err(|e| e.to_string())?
            .is_some();
        if !still_has_error {
            return Ok(state.config.lock().map_err(|e| e.to_string())?.clone());
        }
        match config::load_config() {
            Ok(loaded) => {
                *state.config.lock().map_err(|e| e.to_string())? = loaded.clone();
                *state.config_error.lock().map_err(|e| e.to_string())? = None;
                return Ok(loaded);
            }
            Err(err) => {
                *state.config_error.lock().map_err(|e| e.to_string())? = Some(err.clone());
                return Err(err);
            }
        }
    }
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
    let _save_guard = state.config_save_lock.lock().await;
    let snapshot = {
        let config = state.config.lock().map_err(|e| e.to_string())?;
        let mut new_config = config.clone();
        if let Some(p) = userdata_path {
            new_config.userdata_path = Some(p);
        }
        if let Some(p) = export_path {
            new_config.export_path = p;
        }
        if let Some(t) = theme {
            new_config.theme = t;
        }
        if let Some(l) = language {
            new_config.language = l;
        }
        new_config
    };
    let snapshot_clone = snapshot.clone();
    tokio::task::spawn_blocking(move || config::save_config(&snapshot_clone))
        .await
        .map_err(|e| e.to_string())??;
    *state.config.lock().map_err(|e| e.to_string())? = snapshot;
    *state.config_error.lock().map_err(|e| e.to_string())? = None;
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
    steam::list_steam_ids(&userdata_path)
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
async fn list_clips_quick(
    userdata_path: String,
    steam_id: String,
    media_type: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<clip::ClipInfo>, String> {
    let game_ids = state
        .game_ids
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    tokio::task::spawn_blocking(move || {
        clip::list_clips_quick(&userdata_path, &steam_id, &media_type, &game_ids)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_clip_duration(clip_folder: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || clip::get_clip_duration(&clip_folder))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn generate_thumbnail(clip_folder: String) -> Result<Option<String>, String> {
    clip::generate_thumbnail(&clip_folder).await
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
async fn trash_clips(clip_folders: Vec<String>) -> BatchResult {
    let mut result = BatchResult {
        succeeded: Vec::new(),
        failed: Vec::new(),
    };
    for clip_folder in clip_folders {
        let item = clip_folder.clone();
        let outcome = tokio::task::spawn_blocking(move || {
            let path = std::path::Path::new(&item);
            if !path.is_dir() {
                return Err("Clip folder does not exist".to_string());
            }
            trash::delete(path).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|value| value);
        match outcome {
            Ok(()) => result.succeeded.push(BatchItemSuccess {
                clip_folder,
                output_path: None,
            }),
            Err(error) => result.failed.push(BatchItemFailure { clip_folder, error }),
        }
    }
    result
}

#[tauri::command]
async fn regenerate_thumbnails(clip_folders: Vec<String>) -> BatchResult {
    let mut result = BatchResult {
        succeeded: Vec::new(),
        failed: Vec::new(),
    };
    for clip_folder in clip_folders {
        let thumbnail_path = std::path::Path::new(&clip_folder).join("thumbnail.jpg");
        let removed = tokio::task::spawn_blocking(move || {
            if thumbnail_path.exists() {
                std::fs::remove_file(thumbnail_path).map_err(|e| e.to_string())?;
            }
            Ok::<(), String>(())
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|value| value);
        let outcome = match removed {
            Ok(()) => clip::generate_thumbnail(&clip_folder)
                .await
                .and_then(|path| path.ok_or_else(|| "No session.mpd files found".to_string())),
            Err(error) => Err(error),
        };
        match outcome {
            Ok(output_path) => result.succeeded.push(BatchItemSuccess {
                clip_folder,
                output_path: Some(output_path),
            }),
            Err(error) => result.failed.push(BatchItemFailure { clip_folder, error }),
        }
    }
    result
}

#[tauri::command]
async fn prepare_preview(clip_folder: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || ffmpeg::prepare_preview(&clip_folder))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_mpv_preview(clip_folder: String, title: String) -> Result<(), String> {
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
    let _guard = state.game_ids_save_lock.lock().await;
    let ids_clone = game_ids.clone();
    tokio::task::spawn_blocking(move || config::save_game_ids(&ids_clone))
        .await
        .map_err(|e| e.to_string())??;
    *state.game_ids.lock().map_err(|e| e.to_string())? = game_ids;
    Ok(())
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
    let fetched = steam::fetch_game_names_batch(&game_ids, &existing).await;
    let _guard = state.game_ids_save_lock.lock().await;
    let mut current = state.game_ids.lock().map_err(|e| e.to_string())?.clone();
    for (id, name) in &fetched {
        current.insert(id.clone(), name.clone());
    }
    let to_save = current.clone();
    tokio::task::spawn_blocking(move || config::save_game_ids(&to_save))
        .await
        .map_err(|e| e.to_string())??;
    *state.game_ids.lock().map_err(|e| e.to_string())? = current.clone();
    Ok(fetched)
}

#[tauri::command]
async fn merge_non_steam_games(
    userdata_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let non_steam =
        tokio::task::spawn_blocking(move || steam::load_non_steam_games(&userdata_path))
            .await
            .map_err(|e| e.to_string())??;
    let _guard = state.game_ids_save_lock.lock().await;
    let mut updated = state.game_ids.lock().map_err(|e| e.to_string())?.clone();
    let mut count = 0;
    for (app_id, app_name) in &non_steam {
        if !updated.contains_key(app_id) || updated.get(app_id) == Some(app_id) {
            updated.insert(app_id.clone(), app_name.clone());
            count += 1;
        }
    }
    if count > 0 {
        let snapshot = updated.clone();
        tokio::task::spawn_blocking(move || config::save_game_ids(&snapshot))
            .await
            .map_err(|e| e.to_string())??;
    }
    *state.game_ids.lock().map_err(|e| e.to_string())? = updated.clone();
    Ok(updated)
}

#[tauri::command]
async fn convert_clips(
    job_id: String,
    clip_folders: Vec<String>,
    export_dir: String,
    game_ids: std::collections::HashMap<String, String>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if job_id.trim().is_empty() {
        return Err("[EXPORT_ERR] job_id must not be empty".to_string());
    }
    let export_path = std::path::Path::new(&export_dir);
    if !export_path.exists() {
        return Err(format!(
            "[EXPORT_ERR] Export directory does not exist: {}",
            export_dir
        ));
    }
    let temp_file = export_path.join(format!(".rainy_write_test_{}", uuid::Uuid::new_v4()));
    if let Err(e) = std::fs::write(&temp_file, b"test") {
        return Err(format!(
            "[EXPORT_ERR] Export directory is not writable: {}",
            e
        ));
    }
    let _ = std::fs::remove_file(temp_file);
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut active = state
            .conversion_job
            .lock()
            .map_err(|e| format!("[EXPORT_ERR] {}", e))?;
        if let Some(job) = active.as_ref() {
            return Err(format!(
                "[EXPORT_ERR] Conversion job {} is already active",
                job.job_id
            ));
        }
        *active = Some(ConversionJob {
            job_id: job_id.clone(),
            cancelled: cancelled.clone(),
        });
    }
    let total = clip_folders.len();
    let mut succeeded = 0;
    let mut failed = 0;
    emit_conversion(
        &app_handle,
        ConversionEvent::JobStarted {
            job_id: job_id.clone(),
            total,
        },
    );
    for (idx, clip_folder) in clip_folders.iter().enumerate() {
        if cancelled.load(Ordering::Acquire) {
            break;
        }
        emit_conversion(
            &app_handle,
            ConversionEvent::ItemStarted {
                job_id: job_id.clone(),
                index: idx,
                clip_folder: clip_folder.clone(),
            },
        );
        match ffmpeg::convert_single_clip(clip_folder, &export_dir, &game_ids, cancelled.clone())
            .await
        {
            Ok(output_path) => {
                succeeded += 1;
                emit_conversion(
                    &app_handle,
                    ConversionEvent::ItemSucceeded {
                        job_id: job_id.clone(),
                        index: idx,
                        clip_folder: clip_folder.clone(),
                        output_path,
                    },
                );
            }
            Err(e) => {
                if cancelled.load(Ordering::Acquire) {
                    break;
                }
                log::error!("Failed to convert clip {}: {}", clip_folder, e);
                failed += 1;
                emit_conversion(
                    &app_handle,
                    ConversionEvent::ItemFailed {
                        job_id: job_id.clone(),
                        index: idx,
                        clip_folder: clip_folder.clone(),
                        error: e,
                    },
                );
            }
        }
    }
    let status = if cancelled.load(Ordering::Acquire) {
        "cancelled"
    } else if failed > 0 {
        "completed-with-errors"
    } else {
        "completed"
    };
    {
        let mut active = state.conversion_job.lock().map_err(|e| e.to_string())?;
        if active.as_ref().is_some_and(|job| job.job_id == job_id) {
            *active = None;
        }
    }
    emit_conversion(
        &app_handle,
        ConversionEvent::JobFinished {
            job_id: job_id.clone(),
            status: status.to_string(),
            total,
            succeeded,
            failed,
        },
    );
    Ok(())
}

#[tauri::command]
fn cancel_conversion(job_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let active = state
        .conversion_job
        .lock()
        .map_err(|e| format!("[EXPORT_ERR] {}", e))?;
    let job = active
        .as_ref()
        .ok_or_else(|| "[EXPORT_ERR] No conversion job is active".to_string())?;
    if job.job_id != job_id {
        return Err(format!(
            "[EXPORT_ERR] Active conversion job id does not match {}",
            job_id
        ));
    }
    job.cancelled.store(true, Ordering::Release);
    Ok(())
}

#[tauri::command]
async fn check_for_updates() -> Result<update::ReleaseInfo, String> {
    update::check_latest_release().await
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
    let (config, config_error) = match config::load_config() {
        Ok(c) => (c, None),
        Err(e) => (config::AppConfig::default(), Some(e)),
    };
    let game_ids = match config::load_game_ids() {
        Ok(ids) => ids,
        Err(err) => {
            log::error!("{}", err);
            std::collections::HashMap::new()
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            config: Mutex::new(config),
            config_error: Mutex::new(config_error),
            config_save_lock: tokio::sync::Mutex::new(()),
            game_ids: Mutex::new(game_ids),
            game_ids_save_lock: tokio::sync::Mutex::new(()),
            conversion_job: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            find_steam_userdata,
            validate_userdata,
            list_steam_ids,
            list_clips,
            list_clips_quick,
            get_clip_duration,
            generate_thumbnail,
            regenerate_thumbnail,
            regenerate_thumbnails,
            trash_clip,
            trash_clips,
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

#[cfg(test)]
mod tests {
    use super::{BatchItemFailure, BatchItemSuccess, BatchResult, ConversionEvent};

    #[test]
    fn serializes_batch_result_and_tagged_conversion_event() {
        let batch = BatchResult {
            succeeded: vec![BatchItemSuccess {
                clip_folder: "a".to_string(),
                output_path: Some("a.jpg".to_string()),
            }],
            failed: vec![BatchItemFailure {
                clip_folder: "b".to_string(),
                error: "bad".to_string(),
            }],
        };
        let value = serde_json::to_value(batch).unwrap();
        assert_eq!(value["succeeded"][0]["output_path"], "a.jpg");
        assert_eq!(value["failed"][0]["error"], "bad");

        let value = serde_json::to_value(ConversionEvent::JobFinished {
            job_id: "job-1".to_string(),
            status: "completed".to_string(),
            total: 2,
            succeeded: 1,
            failed: 1,
        })
        .unwrap();
        assert_eq!(value["type"], "job-finished");
        assert_eq!(value["job_id"], "job-1");
    }
}
