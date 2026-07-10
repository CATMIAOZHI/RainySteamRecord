// RainySteamRecord — FFmpeg conversion logic
// Copyright (C) 2026 CATMIAOZHI
// Licensed under GPL-3.0. Portions based on SteamClip by Nastas95 (GPL-3.0).

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

fn ffmpeg_path() -> Result<String, String> {
    let local_appdata = std::env::var("LOCALAPPDATA").map_err(|e| e.to_string())?;
    let bundled = PathBuf::from(&local_appdata)
        .join("RainySteamRecord")
        .join("ffmpeg.exe");
    if bundled.exists() {
        return Ok(bundled.to_string_lossy().to_string());
    }
    let which = Command::new("where").arg("ffmpeg").output();
    if let Ok(output) = which {
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout);
            let p = s.lines().next().unwrap_or("ffmpeg").trim();
            return Ok(p.to_string());
        }
    }
    Err("FFmpeg not found. Please install FFmpeg or bundle it.".to_string())
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

fn find_session_mpd_files(clip_folder: &str) -> Vec<String> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(clip_folder) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let mpd = entry.path().join("session.mpd");
                if mpd.is_file() {
                    files.push(mpd.to_string_lossy().to_string());
                }
            }
        }
    }
    files
}

fn concat_init_and_chunks(data_dir: &Path, stream_num: u32) -> Result<PathBuf, String> {
    let init_file = data_dir.join(format!("init-stream{}.m4s", stream_num));
    if !init_file.exists() {
        return Err(format!("init-stream{}.m4s missing", stream_num));
    }
    let chunk_pattern = format!("chunk-stream{}-*.m4s", stream_num);
    let mut chunks: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(data_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&format!("chunk-stream{}-", stream_num)) && name.ends_with(".m4s") {
                chunks.push(entry.path());
            }
        }
    }
    chunks.sort_by(|a, b| natural_sort(
        &a.file_name().unwrap().to_string_lossy(),
        &b.file_name().unwrap().to_string_lossy(),
    ));
    if chunks.is_empty() {
        return Err(format!("No chunk files for stream{}", stream_num));
    }
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join(format!("rainy_stream_{}_{}.mp4", stream_num, uuid::Uuid::new_v4()));
    let mut file = fs::File::create(&temp_file).map_err(|e| e.to_string())?;
    let init_data = fs::read(&init_file).map_err(|e| e.to_string())?;
    file.write_all(&init_data).map_err(|e| e.to_string())?;
    for chunk in &chunks {
        let data = fs::read(chunk).map_err(|e| e.to_string())?;
        file.write_all(&data).map_err(|e| e.to_string())?;
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(temp_file)
}

fn concatenate_media_files(media_paths: &[PathBuf], is_video: bool) -> Result<PathBuf, String> {
    let ffmpeg = ffmpeg_path()?;
    let temp_dir = std::env::temp_dir();
    let output_file = temp_dir.join(format!("rainy_concat_{}_{}.mp4",
        if is_video { "video" } else { "audio" },
        uuid::Uuid::new_v4()));
    let list_file = temp_dir.join(format!("rainy_list_{}.txt", uuid::Uuid::new_v4()));
    let mut list_content = String::new();
    for path in media_paths {
        list_content.push_str(&format!("file '{}'\n", path.to_string_lossy().replace('\\', "/")));
    }
    fs::write(&list_file, &list_content).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(&ffmpeg);
    cmd.args(&["-f", "concat", "-safe", "0", "-i"])
        .arg(&list_file)
        .args(&["-c", "copy"]);
    if is_video {
        cmd.args(&["-movflags", "+faststart", "-max_muxing_queue_size", "1024"]);
    }
    cmd.arg(&output_file);
    cmd.stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    let result = cmd.output().map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&list_file);
    if !result.status.success() {
        return Err(format!("FFmpeg concat failed: {}", String::from_utf8_lossy(&result.stderr)));
    }
    Ok(output_file)
}

fn generate_output_filename(clip_folder: &str, game_ids: &HashMap<String, String>) -> Result<String, String> {
    let folder_name = Path::new(clip_folder)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown");
    let parts: Vec<&str> = folder_name.split('_').collect();
    let game_id = if parts.len() > 1 { parts[1] } else { "UnknownGame" };
    let game_name = game_ids.get(game_id).map(|s| s.as_str()).unwrap_or(game_id);
    let sanitized = sanitize_filename::sanitize(game_name);
    let formatted_date = if parts.len() >= 3 {
        let datetime_str = format!("{}{}", parts[parts.len() - 2], parts[parts.len() - 1]);
        if datetime_str.len() >= 14 {
            format!("{}_{}_{}_{}-{}-{}",
                &datetime_str[0..4],
                &datetime_str[4..6],
                &datetime_str[6..8],
                &datetime_str[8..10],
                &datetime_str[10..12],
                &datetime_str[12..14],
            )
        } else {
            "UnknownDate".to_string()
        }
    } else {
        "UnknownDate".to_string()
    };
    let base = format!("{}_{}.mp4", sanitized, formatted_date);
    Ok(base)
}

fn get_unique_filename(export_dir: &str, filename: &str) -> String {
    let full_path = Path::new(export_dir).join(filename);
    if !full_path.exists() {
        return full_path.to_string_lossy().to_string();
    }
    let stem = Path::new(filename).file_stem().and_then(|s| s.to_str()).unwrap_or("output");
    let ext = Path::new(filename).extension().and_then(|s| s.to_str()).unwrap_or("mp4");
    for i in 1..1000 {
        let new_name = format!("{}_{}.{}", stem, i, ext);
        let new_path = Path::new(export_dir).join(&new_name);
        if !new_path.exists() {
            return new_path.to_string_lossy().to_string();
        }
    }
    full_path.to_string_lossy().to_string()
}

pub async fn convert_single_clip(
    clip_folder: &str,
    export_dir: &str,
    game_ids: &HashMap<String, String>,
) -> Result<(), String> {
    let session_mpd_files = find_session_mpd_files(clip_folder);
    if session_mpd_files.is_empty() {
        return Err("No session.mpd files found".to_string());
    }
    let mut temp_video_paths = Vec::new();
    let mut temp_audio_paths = Vec::new();
    for session_mpd in &session_mpd_files {
        let data_dir = Path::new(session_mpd).parent().ok_or("Invalid path")?;
        let video_path = concat_init_and_chunks(data_dir, 0)?;
        let audio_path = concat_init_and_chunks(data_dir, 1)?;
        temp_video_paths.push(video_path);
        temp_audio_paths.push(audio_path);
    }
    let concatenated_video = concatenate_media_files(&temp_video_paths, true)?;
    let concatenated_audio = concatenate_media_files(&temp_audio_paths, false)?;
    let output_filename = generate_output_filename(clip_folder, game_ids)?;
    let output_file = get_unique_filename(export_dir, &output_filename);
    let ffmpeg = ffmpeg_path()?;
    let result = Command::new(&ffmpeg)
        .args(&["-i"])
        .arg(&concatenated_video)
        .args(&["-i"])
        .arg(&concatenated_audio)
        .args(&["-c", "copy"])
        .arg(&output_file)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&concatenated_video);
    let _ = fs::remove_file(&concatenated_audio);
    for p in &temp_video_paths { let _ = fs::remove_file(p); }
    for p in &temp_audio_paths { let _ = fs::remove_file(p); }
    if !result.status.success() {
        return Err(format!("FFmpeg merge failed: {}", String::from_utf8_lossy(&result.stderr)));
    }
    Ok(())
}

pub fn extract_first_frame(session_mpd_path: &str, output_thumbnail_path: &str) -> Result<(), String> {
    let ffmpeg = ffmpeg_path()?;
    let data_dir = Path::new(session_mpd_path).parent().ok_or("Invalid path")?;
    let init_video = data_dir.join("init-stream0.m4s");
    if !init_video.exists() {
        return Err("init-stream0.m4s missing".to_string());
    }
    let chunk_pattern = "chunk-stream0-*.m4s";
    let mut chunks: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(data_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("chunk-stream0-") && name.ends_with(".m4s") {
                chunks.push(entry.path());
            }
        }
    }
    chunks.sort_by(|a, b| natural_sort(
        &a.file_name().unwrap().to_string_lossy(),
        &b.file_name().unwrap().to_string_lossy(),
    ));
    if chunks.is_empty() {
        return Err("No chunk files".to_string());
    }
    let temp_dir = std::env::temp_dir();
    let temp_video = temp_dir.join(format!("rainy_thumb_{}.mp4", uuid::Uuid::new_v4()));
    {
        let mut file = fs::File::create(&temp_video).map_err(|e| e.to_string())?;
        let init_data = fs::read(&init_video).map_err(|e| e.to_string())?;
        file.write_all(&init_data).map_err(|e| e.to_string())?;
        let chunk_data = fs::read(&chunks[0]).map_err(|e| e.to_string())?;
        file.write_all(&chunk_data).map_err(|e| e.to_string())?;
    }
    let result = Command::new(&ffmpeg)
        .args(&["-y", "-ss", "00:00:00.000"])
        .arg(&temp_video)
        .args(&["-vframes", "1", "-q:v", "2"])
        .arg(output_thumbnail_path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&temp_video);
    if !result.status.success() {
        return Err("FFmpeg thumbnail extraction failed".to_string());
    }
    Ok(())
}