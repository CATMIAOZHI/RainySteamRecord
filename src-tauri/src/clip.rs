// RainySteamRecord — Clip scanning, duration parsing, thumbnails
// Copyright (C) 2026 CATMIAOZHI
// Licensed under GPL-3.0.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::SystemTime;
use tokio::sync::Semaphore;

static THUMB_SEMAPHORE: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(2));

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ClipsCacheEntry {
    clips: Vec<ClipInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipInfo {
    pub folder: String,
    pub folder_name: String,
    pub game_id: String,
    pub game_name: String,
    pub datetime: Option<String>,
    pub duration: String,
    pub media_type: String,
}

pub(crate) fn folder_datetime(folder_name: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = folder_name.split('_').collect();
    let (date, time) = parts.windows(2).find_map(|pair| {
        let date = pair[0];
        let time = pair[1];
        if date.len() == 8
            && time.len() == 6
            && date.chars().all(|c| c.is_ascii_digit())
            && time.chars().all(|c| c.is_ascii_digit())
        {
            Some((date, time))
        } else {
            None
        }
    })?;
    Some((
        format!(
            "{}-{}-{} {}:{}:{}",
            &date[0..4],
            &date[4..6],
            &date[6..8],
            &time[0..2],
            &time[2..4],
            &time[4..6]
        ),
        format!(
            "{}_{}_{}_{}-{}-{}",
            &date[0..4],
            &date[4..6],
            &date[6..8],
            &time[0..2],
            &time[2..4],
            &time[4..6]
        ),
    ))
}

fn cache_file() -> PathBuf {
    let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| {
        std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users".to_string())
    });
    PathBuf::from(local_appdata)
        .join("RainySteamRecord")
        .join("clips_cache.json")
}

fn cache_key(userdata_path: &str, steam_id: &str, media_type: &str) -> String {
    format!("{}|{}|{}", userdata_path, steam_id, media_type)
}

fn read_clips_cache() -> HashMap<String, ClipsCacheEntry> {
    let path = cache_file();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(cache) = serde_json::from_str::<HashMap<String, ClipsCacheEntry>>(&content) {
            return cache;
        }
    }
    HashMap::new()
}

fn write_clips_cache(cache: &HashMap<String, ClipsCacheEntry>) {
    let path = cache_file();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(content) = serde_json::to_string_pretty(cache) {
        let _ = std::fs::write(&path, content);
    }
}

pub fn list_clips(
    userdata_path: &str,
    steam_id: &str,
    media_type: &str,
    game_ids: &HashMap<String, String>,
    use_cache: bool,
) -> Result<Vec<ClipInfo>, String> {
    if use_cache {
        let key = cache_key(userdata_path, steam_id, media_type);
        let cache = read_clips_cache();
        if let Some(entry) = cache.get(&key) {
            return Ok(entry.clips.clone());
        }
    }

    let userdata_dir = Path::new(userdata_path).join(steam_id);
    let custom_path = crate::steam::get_custom_record_path(&userdata_dir.to_string_lossy());

    let clips_dir_default = userdata_dir.join("gamerecordings").join("clips");
    let video_dir_default = userdata_dir.join("gamerecordings").join("video");
    let clips_dir_custom = custom_path.as_ref().map(|p| Path::new(p).join("clips"));
    let video_dir_custom = custom_path.as_ref().map(|p| Path::new(p).join("video"));

    let mut clip_folders = Vec::new();
    let mut video_folders = Vec::new();

    if clips_dir_default.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&clips_dir_default) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.contains('_') {
                        clip_folders.push((
                            entry.path().to_string_lossy().to_string(),
                            "manual".to_string(),
                        ));
                    }
                }
            }
        }
    }
    if video_dir_default.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&video_dir_default) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.contains('_') {
                        video_folders.push((
                            entry.path().to_string_lossy().to_string(),
                            "background".to_string(),
                        ));
                    }
                }
            }
        }
    }
    if let Some(ref custom_clips) = clips_dir_custom {
        if custom_clips.is_dir() {
            if let Ok(entries) = std::fs::read_dir(custom_clips) {
                for entry in entries.flatten() {
                    if entry.path().is_dir() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.contains('_') {
                            clip_folders.push((
                                entry.path().to_string_lossy().to_string(),
                                "manual".to_string(),
                            ));
                        }
                    }
                }
            }
        }
    }
    if let Some(ref custom_video) = video_dir_custom {
        if custom_video.is_dir() {
            if let Ok(entries) = std::fs::read_dir(custom_video) {
                for entry in entries.flatten() {
                    if entry.path().is_dir() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.contains('_') {
                            video_folders.push((
                                entry.path().to_string_lossy().to_string(),
                                "background".to_string(),
                            ));
                        }
                    }
                }
            }
        }
    }

    let all_clips: Vec<(String, String)> = match media_type {
        "all" => clip_folders
            .into_iter()
            .chain(video_folders.into_iter())
            .collect(),
        "manual" => clip_folders,
        "background" => video_folders,
        _ => clip_folders
            .into_iter()
            .chain(video_folders.into_iter())
            .collect(),
    };

    let mut clips: Vec<ClipInfo> = all_clips
        .into_iter()
        .map(|(folder, mt)| {
            let folder_name = Path::new(&folder)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let parts: Vec<&str> = folder_name.split('_').collect();
            let game_id = if parts.len() > 1 {
                parts[1].to_string()
            } else {
                "Unknown".to_string()
            };
            let game_name = game_ids
                .get(&game_id)
                .cloned()
                .unwrap_or_else(|| game_id.clone());
            let datetime = folder_datetime(&folder_name).map(|value| value.0);
            let duration = get_clip_duration(&folder).unwrap_or_else(|_| "?".to_string());
            ClipInfo {
                folder,
                folder_name,
                game_id,
                game_name,
                datetime,
                duration,
                media_type: mt,
            }
        })
        .collect();

    clips.sort_by(|a, b| {
        let dt_a = a.datetime.as_ref().map(|s| s.as_str()).unwrap_or("");
        let dt_b = b.datetime.as_ref().map(|s| s.as_str()).unwrap_or("");
        dt_b.cmp(dt_a)
    });

    if use_cache {
        let key = cache_key(userdata_path, steam_id, media_type);
        let mut cache = read_clips_cache();
        cache.insert(
            key,
            ClipsCacheEntry {
                clips: clips.clone(),
            },
        );
        write_clips_cache(&cache);
    }

    Ok(clips)
}

pub fn get_clip_duration(clip_folder: &str) -> Result<String, String> {
    let session_mpd_files = crate::streaming::find_session_mpd_paths(clip_folder);
    if session_mpd_files.is_empty() {
        return Ok("0:00".to_string());
    }
    let mut total_seconds = 0.0;
    for mpd_path in &session_mpd_files {
        if let Ok(content) = std::fs::read_to_string(mpd_path) {
            if let Some(duration_start) = content.find("mediaPresentationDuration=\"") {
                let rest = &content[duration_start + "mediaPresentationDuration=\"".len()..];
                if let Some(end) = rest.find('"') {
                    let duration_str = &rest[..end];
                    total_seconds += parse_iso8601_duration(duration_str);
                }
            }
        }
    }
    let minutes = (total_seconds / 60.0) as i32;
    let seconds = (total_seconds % 60.0) as i32;
    Ok(format!("{}:{:02}", minutes, seconds))
}

fn parse_iso8601_duration(s: &str) -> f64 {
    let s = s.strip_prefix("PT").unwrap_or(s);
    let mut total = 0.0;
    let mut num = String::new();
    for ch in s.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            num.push(ch);
        } else {
            if let Ok(val) = num.parse::<f64>() {
                match ch {
                    'H' => total += val * 3600.0,
                    'M' => total += val * 60.0,
                    'S' => total += val,
                    _ => {}
                }
            }
            num.clear();
        }
    }
    total
}

pub async fn generate_thumbnail(clip_folder: &str) -> Result<Option<String>, String> {
    let thumbnail_path = Path::new(clip_folder).join("thumbnail.jpg");
    if thumbnail_path.metadata().map(|m| m.len() > 0).unwrap_or(false) {
        return Ok(Some(thumbnail_path.to_string_lossy().to_string()));
    }
    let _permit = THUMB_SEMAPHORE.acquire().await.map_err(|e| e.to_string())?;
    let clip_folder = clip_folder.to_string();
    tokio::task::spawn_blocking(move || {
        let thumbnail_path = Path::new(&clip_folder).join("thumbnail.jpg");
        if thumbnail_path.metadata().map(|m| m.len() > 0).unwrap_or(false) {
            return Ok(Some(thumbnail_path.to_string_lossy().to_string()));
        }
        let temp_thumbnail = Path::new(&clip_folder).join(format!(
            ".thumbnail-{}.jpg",
            uuid::Uuid::new_v4()
        ));
        let session_mpd_files = crate::streaming::find_session_mpd_paths(&clip_folder);
        if let Some(first_mpd) = session_mpd_files.first() {
            let result = crate::ffmpeg::extract_first_frame(
                &first_mpd.to_string_lossy(),
                &temp_thumbnail.to_string_lossy(),
            );
            if let Err(error) = result {
                let _ = std::fs::remove_file(&temp_thumbnail);
                log::warn!("Failed to generate thumbnail for {}: {}", clip_folder, error);
                return Err(error);
            }
            if temp_thumbnail.metadata().map(|m| m.len() > 0).unwrap_or(false) {
                let _ = std::fs::remove_file(&thumbnail_path);
                std::fs::rename(&temp_thumbnail, &thumbnail_path).map_err(|e| e.to_string())?;
                return Ok(Some(thumbnail_path.to_string_lossy().to_string()));
            }
            let _ = std::fs::remove_file(&temp_thumbnail);
        }
        Ok(None)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn _unused() -> SystemTime {
    SystemTime::now()
}
fn _unused2() -> PathBuf {
    PathBuf::new()
}

#[cfg(test)]
mod tests {
    use super::folder_datetime;

    #[test]
    fn parses_folder_datetime_with_optional_suffix() {
        assert_eq!(
            folder_datetime("bg_787480_20260624_222931_0").map(|value| value.0),
            Some("2026-06-24 22:29:31".to_string())
        );
        assert_eq!(
            folder_datetime("bg_2001120_20250510_104627").map(|value| value.0),
            Some("2025-05-10 10:46:27".to_string())
        );
    }
}
