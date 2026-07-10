use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::ipc::Response;

#[derive(Serialize)]
pub struct SessionInfo {
    pub session_dir: String,
    pub video_codec: String,
    pub audio_codec: String,
    pub video_init: String,
    pub audio_init: String,
    pub video_chunks: Vec<String>,
    pub audio_chunks: Vec<String>,
}

#[derive(Serialize)]
pub struct ClipStreamInfo {
    pub sessions: Vec<SessionInfo>,
}

fn natural_sort(a: &str, b: &str) -> std::cmp::Ordering {
    let an: Vec<&str> = a.split('-').collect();
    let bn: Vec<&str> = b.split('-').collect();
    let anum: u32 = an.iter().rev().find(|s| s.chars().all(|c| c.is_ascii_digit()))
        .and_then(|s| s.parse().ok()).unwrap_or(0);
    let bnum: u32 = bn.iter().rev().find(|s| s.chars().all(|c| c.is_ascii_digit()))
        .and_then(|s| s.parse().ok()).unwrap_or(0);
    anum.cmp(&bnum)
}

pub fn find_session_mpd_paths(clip_folder: &str) -> Vec<PathBuf> {
    let mut files = Vec::new();
    fn walk_dir(dir: &Path, files: &mut Vec<PathBuf>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk_dir(&path, files);
                } else if path.file_name().map(|n| n == "session.mpd").unwrap_or(false) {
                    files.push(path);
                }
            }
        }
    }
    walk_dir(Path::new(clip_folder), &mut files);
    files.sort();
    files
}

fn find_session_dirs(clip_folder: &str) -> Vec<PathBuf> {
    find_session_mpd_paths(clip_folder)
        .into_iter()
        .filter_map(|p| p.parent().map(|d| d.to_path_buf()))
        .collect()
}

fn extract_codec(mpd_content: &str, content_type: &str) -> Option<String> {
    let mut in_adaptation = false;
    let mut current_type = String::new();
    for line in mpd_content.lines() {
        let trimmed = line.trim();
        if trimmed.contains("<AdaptationSet") {
            in_adaptation = true;
            current_type = String::new();
        }
        if in_adaptation && trimmed.contains("contentType=") {
            if let Some(start) = trimmed.find("contentType=\"") {
                let rest = &trimmed[start + "contentType=\"".len()..];
                if let Some(end) = rest.find('"') {
                    current_type = rest[..end].to_string();
                }
            }
        }
        if in_adaptation && current_type == content_type && trimmed.contains("codecs=") {
            if let Some(start) = trimmed.find("codecs=\"") {
                let rest = &trimmed[start + "codecs=\"".len()..];
                if let Some(end) = rest.find('"') {
                    return Some(rest[..end].to_string());
                }
            }
        }
        if trimmed.contains("</AdaptationSet>") {
            in_adaptation = false;
        }
    }
    None
}

fn collect_chunks(session_dir: &Path, stream_num: u32) -> Vec<String> {
    let prefix = format!("chunk-stream{}-", stream_num);
    let mut chunks: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(session_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&prefix) && name.ends_with(".m4s") {
                chunks.push(entry.path());
            }
        }
    }
    chunks.sort_by(|a, b| natural_sort(
        &a.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        &b.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
    ));
    chunks.into_iter().map(|p| p.to_string_lossy().to_string()).collect()
}

pub fn get_clip_stream_info(clip_folder: &str) -> Result<ClipStreamInfo, String> {
    let session_dirs = find_session_dirs(clip_folder);
    if session_dirs.is_empty() {
        return Err("No session.mpd files found".to_string());
    }
    let mut sessions = Vec::new();
    for dir in &session_dirs {
        let mpd_path = dir.join("session.mpd");
        let mpd_content = fs::read_to_string(&mpd_path)
            .map_err(|e| format!("Failed to read MPD: {}", e))?;
        let video_codec = extract_codec(&mpd_content, "video")
            .unwrap_or_else(|| "avc1.42E01E".to_string());
        let audio_codec = extract_codec(&mpd_content, "audio")
            .unwrap_or_else(|| "mp4a.40.2".to_string());
        let video_init = dir.join("init-stream0.m4s").to_string_lossy().to_string();
        let audio_init = dir.join("init-stream1.m4s").to_string_lossy().to_string();
        let video_chunks = collect_chunks(dir, 0);
        let audio_chunks = collect_chunks(dir, 1);
        sessions.push(SessionInfo {
            session_dir: dir.to_string_lossy().to_string(),
            video_codec,
            audio_codec,
            video_init,
            audio_init,
            video_chunks,
            audio_chunks,
        });
    }
    Ok(ClipStreamInfo { sessions })
}

pub fn read_segment_bytes(file_path: &str) -> Result<Response, String> {
    let data = fs::read(file_path).map_err(|e| format!("Failed to read segment: {}", e))?;
    Ok(Response::new(data))
}