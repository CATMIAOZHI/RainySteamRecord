// RainySteamRecord — Clip scanning, duration parsing, thumbnails
// Copyright (C) 2026 CATMIAOZHI
// Licensed under GPL-3.0.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use tokio::sync::Semaphore;

static THUMB_SEMAPHORE: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(2));
static CACHE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
const CACHE_VERSION: u32 = 3;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct ClipsCacheEntry {
    clips: HashMap<String, CachedClip>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedClip {
    fingerprint: u64,
    clip: ClipInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ClipsCache {
    version: u32,
    entries: HashMap<String, ClipsCacheEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipInfo {
    pub folder: String,
    pub folder_name: String,
    pub game_id: String,
    pub game_name: String,
    pub datetime: Option<String>,
    pub duration: String,
    pub duration_seconds: f64,
    pub size_bytes: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub frame_rate: Option<f64>,
    pub session_count: usize,
    pub health_status: String,
    pub issues: Vec<String>,
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

fn read_clips_cache() -> ClipsCache {
    let path = cache_file();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(cache) = serde_json::from_str::<ClipsCache>(&content) {
            if cache.version == CACHE_VERSION {
                return cache;
            }
        }
    }
    ClipsCache {
        version: CACHE_VERSION,
        entries: HashMap::new(),
    }
}

fn write_clips_cache(cache: &ClipsCache) -> Result<(), String> {
    let path = cache_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_vec_pretty(cache).map_err(|e| e.to_string())?;
    let temp = path.with_extension(format!("json.{}.tmp", uuid::Uuid::new_v4()));
    let mut file = std::fs::File::create(&temp).map_err(|e| e.to_string())?;
    use std::io::Write;
    file.write_all(&content).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    replace_file(&temp, &path).inspect_err(|_| {
        let _ = std::fs::remove_file(&temp);
    })
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

fn recording_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("mpd") || value.eq_ignore_ascii_case("m4s"))
}

fn issue(code: &str, path: &Path) -> String {
    format!("{}: {}", code, path.display())
}

fn inspect_folder(folder: &Path) -> (u64, u64, Vec<String>) {
    let mut size = 0u64;
    let mut fingerprint = 14695981039346656037u64;
    let mut issues = Vec::new();
    for entry in walkdir::WalkDir::new(folder) {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                issues.push(issue("directory-entry-unavailable", folder));
                continue;
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }
        if !recording_file(entry.path()) {
            continue;
        }
        match entry.metadata() {
            Ok(metadata) => {
                size = size.saturating_add(metadata.len());
                if metadata.len() == 0 {
                    issues.push(issue("zero-byte-file", entry.path()));
                }
                for byte in entry
                    .path()
                    .strip_prefix(folder)
                    .unwrap_or(entry.path())
                    .to_string_lossy()
                    .bytes()
                    .chain(metadata.len().to_le_bytes())
                    .chain(
                        metadata
                            .modified()
                            .ok()
                            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|value| value.as_nanos() as u64)
                            .unwrap_or(0)
                            .to_le_bytes(),
                    )
                {
                    fingerprint ^= byte as u64;
                    fingerprint = fingerprint.wrapping_mul(1099511628211);
                }
            }
            Err(_) => issues.push(issue("file-metadata-unavailable", entry.path())),
        }
    }
    (size, fingerprint, issues)
}

fn validate_session(mpd_path: &Path, issues: &mut Vec<String>) {
    let Some(folder) = mpd_path.parent() else {
        issues.push(issue("invalid-session-path", mpd_path));
        return;
    };
    for stream in 0..=1 {
        let kind = if stream == 0 { "video" } else { "audio" };
        let init = folder.join(format!("init-stream{}.m4s", stream));
        if !init.is_file() {
            issues.push(issue(&format!("missing-{}-init", kind), &init));
        }
        let prefix = format!("chunk-stream{}-", stream);
        let mut chunks: Vec<(u32, PathBuf)> = std::fs::read_dir(folder)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with(&prefix) || !entry.path().is_file() {
                    return None;
                }
                crate::streaming::segment_number(&name).map(|number| (number, entry.path()))
            })
            .collect();
        chunks.sort_by_key(|value| value.0);
        if chunks.is_empty() {
            issues.push(issue(&format!("missing-{}-chunks", kind), folder));
        } else if chunks.windows(2).any(|pair| pair[1].0 != pair[0].0 + 1) {
            issues.push(issue(&format!("non-contiguous-{}-chunks", kind), folder));
        }
    }
}

fn build_clip(
    folder: String,
    media_type: String,
    game_ids: &HashMap<String, String>,
    size_bytes: u64,
    mut issues: Vec<String>,
) -> ClipInfo {
    let folder_name = Path::new(&folder)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let parts: Vec<&str> = folder_name.split('_').collect();
    let game_id = parts.get(1).copied().unwrap_or("Unknown").to_string();
    let game_name = game_ids
        .get(&game_id)
        .cloned()
        .unwrap_or_else(|| game_id.clone());
    let mpd_paths = crate::streaming::find_session_mpd_paths(&folder);
    if mpd_paths.is_empty() {
        issues.push(issue("missing-session-mpd", Path::new(&folder)));
    }
    let mut duration_seconds = 0.0;
    let mut width = None;
    let mut height = None;
    let mut video_codec = None;
    let mut audio_codec = None;
    let mut frame_rate = None;
    for path in &mpd_paths {
        validate_session(path, &mut issues);
        match std::fs::read_to_string(path)
            .map_err(|e| e.to_string())
            .and_then(|content| crate::streaming::parse_mpd_metadata(&content))
        {
            Ok(metadata) => {
                duration_seconds += metadata.duration_seconds;
                width = width.or(metadata.width);
                height = height.or(metadata.height);
                video_codec = video_codec.or(metadata.video_codec);
                audio_codec = audio_codec.or(metadata.audio_codec);
                frame_rate = frame_rate.or(metadata.frame_rate);
            }
            Err(_) => issues.push(issue("invalid-session-mpd", path)),
        }
    }
    let health_status = if mpd_paths.is_empty()
        || duration_seconds <= 0.0
        || issues.iter().any(|value| {
            value.starts_with("missing-")
                || value.starts_with("zero-byte-file:")
                || value.starts_with("invalid-session-mpd:")
        }) {
        "error"
    } else if issues.is_empty() {
        "healthy"
    } else {
        "warning"
    }
    .to_string();
    ClipInfo {
        folder,
        folder_name: folder_name.clone(),
        game_id,
        game_name,
        datetime: folder_datetime(&folder_name).map(|value| value.0),
        duration: format!(
            "{}:{:02}",
            (duration_seconds / 60.0) as u64,
            (duration_seconds % 60.0) as u64
        ),
        duration_seconds,
        size_bytes,
        width,
        height,
        video_codec,
        audio_codec,
        frame_rate,
        session_count: mpd_paths.len(),
        health_status,
        issues,
        media_type,
    }
}

pub fn list_clips(
    userdata_path: &str,
    steam_id: &str,
    media_type: &str,
    game_ids: &HashMap<String, String>,
    use_cache: bool,
) -> Result<Vec<ClipInfo>, String> {
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

    let key = cache_key(userdata_path, steam_id, media_type);
    let old_clips = if use_cache {
        let _guard = CACHE_LOCK.lock().map_err(|e| e.to_string())?;
        read_clips_cache()
            .entries
            .get(&key)
            .cloned()
            .unwrap_or_default()
            .clips
    } else {
        HashMap::new()
    };
    let mut new_cached = HashMap::new();
    let mut clips: Vec<ClipInfo> = all_clips
        .into_iter()
        .map(|(folder, mt)| {
            let (size, fingerprint, issues) = inspect_folder(Path::new(&folder));
            let mut clip = if use_cache {
                old_clips
                    .get(&folder)
                    .filter(|cached| cached.fingerprint == fingerprint)
                    .map(|cached| cached.clip.clone())
                    .unwrap_or_else(|| {
                        build_clip(folder.clone(), mt.clone(), game_ids, size, issues)
                    })
            } else {
                build_clip(folder.clone(), mt.clone(), game_ids, size, issues)
            };
            clip.game_name = game_ids
                .get(&clip.game_id)
                .cloned()
                .unwrap_or_else(|| clip.game_id.clone());
            new_cached.insert(
                folder,
                CachedClip {
                    fingerprint,
                    clip: clip.clone(),
                },
            );
            clip
        })
        .collect();

    clips.sort_by(|a, b| {
        let dt_a = a.datetime.as_ref().map(|s| s.as_str()).unwrap_or("");
        let dt_b = b.datetime.as_ref().map(|s| s.as_str()).unwrap_or("");
        dt_b.cmp(dt_a)
    });

    if use_cache {
        let _guard = CACHE_LOCK.lock().map_err(|e| e.to_string())?;
        let mut cache = read_clips_cache();
        cache
            .entries
            .insert(key, ClipsCacheEntry { clips: new_cached });
        if let Err(error) = write_clips_cache(&cache) {
            log::warn!("Failed to write clip cache: {}", error);
        }
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
        let content = std::fs::read_to_string(mpd_path).map_err(|e| e.to_string())?;
        total_seconds += crate::streaming::parse_mpd_metadata(&content)?.duration_seconds;
    }
    let minutes = (total_seconds / 60.0) as i32;
    let seconds = (total_seconds % 60.0) as i32;
    Ok(format!("{}:{:02}", minutes, seconds))
}

pub async fn generate_thumbnail(clip_folder: &str) -> Result<Option<String>, String> {
    let thumbnail_path = Path::new(clip_folder).join("thumbnail.jpg");
    if thumbnail_path
        .metadata()
        .map(|m| m.len() > 0)
        .unwrap_or(false)
    {
        return Ok(Some(thumbnail_path.to_string_lossy().to_string()));
    }
    let _permit = THUMB_SEMAPHORE.acquire().await.map_err(|e| e.to_string())?;
    let clip_folder = clip_folder.to_string();
    tokio::task::spawn_blocking(move || {
        let thumbnail_path = Path::new(&clip_folder).join("thumbnail.jpg");
        if thumbnail_path
            .metadata()
            .map(|m| m.len() > 0)
            .unwrap_or(false)
        {
            return Ok(Some(thumbnail_path.to_string_lossy().to_string()));
        }
        let temp_thumbnail =
            Path::new(&clip_folder).join(format!(".thumbnail-{}.jpg", uuid::Uuid::new_v4()));
        let session_mpd_files = crate::streaming::find_session_mpd_paths(&clip_folder);
        if let Some(first_mpd) = session_mpd_files.first() {
            let result = crate::ffmpeg::extract_first_frame(
                &first_mpd.to_string_lossy(),
                &temp_thumbnail.to_string_lossy(),
            );
            if let Err(error) = result {
                let _ = std::fs::remove_file(&temp_thumbnail);
                log::warn!(
                    "Failed to generate thumbnail for {}: {}",
                    clip_folder,
                    error
                );
                return Err(error);
            }
            if temp_thumbnail
                .metadata()
                .map(|m| m.len() > 0)
                .unwrap_or(false)
            {
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

#[cfg(test)]
mod tests {
    use super::{build_clip, folder_datetime, inspect_folder};
    use std::collections::HashMap;

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

    #[test]
    fn aggregates_multiple_sessions_and_directory_size() {
        let root = std::env::temp_dir().join(format!("rainy-clip-test-{}", uuid::Uuid::new_v4()));
        let first = root.join("a");
        let second = root.join("b");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        let mpd = |duration: u32| {
            format!(
                r#"<MPD mediaPresentationDuration="PT{}S"><Period><AdaptationSet contentType="video" codecs="avc1.640028"><Representation width="1280" height="720" frameRate="60/1" /></AdaptationSet><AdaptationSet contentType="audio" codecs="mp4a.40.2" /></Period></MPD>"#,
                duration
            )
        };
        std::fs::write(first.join("session.mpd"), mpd(10)).unwrap();
        std::fs::write(second.join("session.mpd"), mpd(20)).unwrap();
        for folder in [&first, &second] {
            std::fs::write(folder.join("init-stream0.m4s"), [1]).unwrap();
            std::fs::write(folder.join("init-stream1.m4s"), [1]).unwrap();
            std::fs::write(folder.join("chunk-stream0-00001.m4s"), [1]).unwrap();
            std::fs::write(folder.join("chunk-stream1-00001.m4s"), [1]).unwrap();
        }
        std::fs::write(root.join("thumbnail.jpg"), [0u8; 7]).unwrap();
        let (size, _, issues) = inspect_folder(&root);
        let clip = build_clip(
            root.to_string_lossy().to_string(),
            "manual".to_string(),
            &HashMap::new(),
            size,
            issues,
        );
        assert_eq!(clip.duration_seconds, 30.0);
        assert_eq!(clip.session_count, 2);
        assert_eq!(
            clip.size_bytes,
            std::fs::metadata(first.join("session.mpd")).unwrap().len()
                + std::fs::metadata(second.join("session.mpd")).unwrap().len()
                + 8
        );
        assert_eq!(clip.health_status, "healthy");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn fingerprint_ignores_derived_files_and_health_checks_streams() {
        let root = std::env::temp_dir().join(format!("rainy-health-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("session.mpd"),
            r#"<MPD mediaPresentationDuration="PT10S" />"#,
        )
        .unwrap();
        std::fs::write(root.join("init-stream0.m4s"), [1]).unwrap();
        std::fs::write(root.join("init-stream1.m4s"), [1]).unwrap();
        std::fs::write(root.join("chunk-stream0-00001.m4s"), [1]).unwrap();
        std::fs::write(root.join("chunk-stream0-00003.m4s"), [1]).unwrap();
        std::fs::write(root.join("chunk-stream1-00001.m4s"), []).unwrap();
        let (_, fingerprint, issues) = inspect_folder(&root);
        std::fs::write(root.join("thumbnail.jpg"), [9u8; 20]).unwrap();
        assert_eq!(inspect_folder(&root).1, fingerprint);
        let clip = build_clip(
            root.to_string_lossy().to_string(),
            "manual".to_string(),
            &HashMap::new(),
            0,
            issues,
        );
        assert_eq!(clip.health_status, "error");
        assert!(clip
            .issues
            .iter()
            .any(|value| value.starts_with("non-contiguous-video-chunks:")));
        assert!(clip
            .issues
            .iter()
            .any(|value| value.starts_with("zero-byte-file:")));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reports_bad_mpd_without_failing_clip_scan() {
        let root =
            std::env::temp_dir().join(format!("rainy-bad-clip-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("session.mpd"), "not xml").unwrap();
        let (size, _, issues) = inspect_folder(&root);
        let clip = build_clip(
            root.to_string_lossy().to_string(),
            "manual".to_string(),
            &HashMap::new(),
            size,
            issues,
        );
        assert_eq!(clip.health_status, "error");
        assert_eq!(clip.session_count, 1);
        assert!(clip
            .issues
            .iter()
            .any(|value| value.starts_with("invalid-session-mpd:")));
        std::fs::remove_dir_all(root).unwrap();
    }
}
