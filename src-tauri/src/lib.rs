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
    pub game_ids: Mutex<std::collections::HashMap<String, String>>,
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
        if let Some(p) = userdata_path {
            config.userdata_path = Some(p);
        }
        if let Some(p) = export_path {
            config.export_path = p;
        }
        if let Some(t) = theme {
            config.theme = t;
        }
        if let Some(l) = language {
            config.language = l;
        }
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
    let non_steam =
        tokio::task::spawn_blocking(move || steam::load_non_steam_games(&userdata_path))
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
    job_id: String,
    clip_folders: Vec<String>,
    export_dir: String,
    game_ids: std::collections::HashMap<String, String>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if job_id.trim().is_empty() {
        return Err("job_id must not be empty".to_string());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut active = state.conversion_job.lock().map_err(|e| e.to_string())?;
        if let Some(job) = active.as_ref() {
            return Err(format!("Conversion job {} is already active", job.job_id));
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
    let mut active = state.conversion_job.lock().map_err(|e| e.to_string())?;
    if active.as_ref().is_some_and(|job| job.job_id == job_id) {
        *active = None;
    }
    Ok(())
}

#[tauri::command]
fn cancel_conversion(job_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let active = state.conversion_job.lock().map_err(|e| e.to_string())?;
    let job = active
        .as_ref()
        .ok_or_else(|| "No conversion job is active".to_string())?;
    if job.job_id != job_id {
        return Err(format!(
            "Active conversion job id does not match {}",
            job_id
        ));
    }
    job.cancelled.store(true, Ordering::Release);
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
            conversion_job: Mutex::new(None),
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
