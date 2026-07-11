// RainySteamRecord — FFmpeg conversion logic
// Copyright (C) 2026 CATMIAOZHI
// Licensed under GPL-3.0. Portions based on SteamClip by Nastas95 (GPL-3.0).

use std::collections::HashMap;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, OnceLock,
};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn create_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

fn ffmpeg_path() -> Result<String, String> {
    static FFMPEG_PATH: OnceLock<Result<String, String>> = OnceLock::new();
    FFMPEG_PATH.get_or_init(resolve_ffmpeg_path).clone()
}

fn resolve_ffmpeg_path() -> Result<String, String> {
    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(parent) = exe_dir.parent() {
            let candidates = [
                parent.join("ffmpeg.exe"),
                parent.join("binaries").join("ffmpeg.exe"),
                parent.join("resources").join("ffmpeg.exe"),
            ];
            for c in &candidates {
                if c.exists() {
                    return Ok(c.to_string_lossy().to_string());
                }
            }
        }
    }
    let local_appdata = std::env::var("LOCALAPPDATA").map_err(|e| e.to_string())?;
    let dev_bundled = PathBuf::from(&local_appdata)
        .join("RainySteamRecord")
        .join("ffmpeg.exe");
    if dev_bundled.exists() {
        return Ok(dev_bundled.to_string_lossy().to_string());
    }
    let dev_local = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join("ffmpeg.exe");
    if dev_local.exists() {
        return Ok(dev_local.to_string_lossy().to_string());
    }
    let which = create_command("where").arg("ffmpeg").output();
    if let Ok(output) = which {
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout);
            let p = s.lines().next().unwrap_or("ffmpeg").trim();
            return Ok(p.to_string());
        }
    }
    Err("FFmpeg not found. Please install FFmpeg or bundle it.".to_string())
}

fn find_session_mpd_files(clip_folder: &str) -> Vec<String> {
    crate::streaming::find_session_mpd_paths(clip_folder)
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

fn concat_init_and_chunks(
    data_dir: &Path,
    stream_num: u32,
    cancelled: &AtomicBool,
) -> Result<PathBuf, String> {
    let init_file = data_dir.join(format!("init-stream{}.m4s", stream_num));
    if !init_file.exists() {
        return Err(format!("init-stream{}.m4s missing", stream_num));
    }
    let mut chunks: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(data_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&format!("chunk-stream{}-", stream_num))
                && crate::streaming::segment_number(&name).is_some()
            {
                chunks.push(entry.path());
            }
        }
    }
    chunks.sort_by(|a, b| {
        crate::streaming::segment_sort(
            &a.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            &b.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
        )
    });
    if chunks.is_empty() {
        return Err(format!("No chunk files for stream{}", stream_num));
    }
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join(format!(
        "rainy_stream_{}_{}.mp4",
        stream_num,
        uuid::Uuid::new_v4()
    ));
    let result = (|| {
        let mut file = fs::File::create(&temp_file).map_err(|e| e.to_string())?;
        for source in std::iter::once(&init_file).chain(chunks.iter()) {
            if cancelled.load(Ordering::Acquire) {
                return Err("Conversion cancelled".to_string());
            }
            let mut input = fs::File::open(source).map_err(|e| e.to_string())?;
            io::copy(&mut input, &mut file).map_err(|e| e.to_string())?;
        }
        file.flush().map_err(|e| e.to_string())?;
        Ok(temp_file.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_file);
    }
    result
}

fn run_command(cmd: &mut Command, cancelled: &AtomicBool) -> Result<(), String> {
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let _job = match crate::process_job::ProcessJob::assign(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    loop {
        if cancelled.load(Ordering::Acquire) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Conversion cancelled".to_string());
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return if status.success() {
                Ok(())
            } else {
                Err(format!("FFmpeg exited with {}", status))
            };
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn concatenate_media_files(
    media_paths: &[PathBuf],
    is_video: bool,
    cancelled: &AtomicBool,
) -> Result<PathBuf, String> {
    let ffmpeg = ffmpeg_path()?;
    let temp_dir = std::env::temp_dir();
    let output_file = temp_dir.join(format!(
        "rainy_concat_{}_{}.mp4",
        if is_video { "video" } else { "audio" },
        uuid::Uuid::new_v4()
    ));
    let list_file = temp_dir.join(format!("rainy_list_{}.txt", uuid::Uuid::new_v4()));
    let mut list_content = String::new();
    for path in media_paths {
        list_content.push_str(&format!(
            "file '{}'\n",
            path.to_string_lossy().replace('\\', "/")
        ));
    }
    fs::write(&list_file, &list_content).map_err(|e| e.to_string())?;
    let mut cmd = create_command(&ffmpeg);
    cmd.args(&["-f", "concat", "-safe", "0", "-i"])
        .arg(&list_file)
        .args(&["-c", "copy"]);
    if is_video {
        cmd.args(&["-movflags", "+faststart", "-max_muxing_queue_size", "1024"]);
    }
    cmd.arg(&output_file);
    cmd.stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    let result = run_command(&mut cmd, cancelled);
    let _ = fs::remove_file(&list_file);
    if result.is_err() {
        let _ = fs::remove_file(&output_file);
    }
    result.map(|_| output_file)
}

fn generate_output_filename(
    clip_folder: &str,
    game_ids: &HashMap<String, String>,
) -> Result<String, String> {
    let folder_name = Path::new(clip_folder)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown");
    let parts: Vec<&str> = folder_name.split('_').collect();
    let game_id = if parts.len() > 1 {
        parts[1]
    } else {
        "UnknownGame"
    };
    let game_name = game_ids.get(game_id).map(|s| s.as_str()).unwrap_or(game_id);
    let sanitized = sanitize_filename::sanitize(game_name);
    let formatted_date = crate::clip::folder_datetime(folder_name)
        .map(|value| value.1)
        .unwrap_or_else(|| "UnknownDate".to_string());
    let base = format!("{}_{}.mp4", sanitized, formatted_date);
    Ok(base)
}

fn get_unique_filename(export_dir: &str, filename: &str) -> String {
    let full_path = Path::new(export_dir).join(filename);
    if !full_path.exists() {
        return full_path.to_string_lossy().to_string();
    }
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = Path::new(filename)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mp4");
    for i in 1..1000 {
        let new_name = format!("{}_{}.{}", stem, i, ext);
        let new_path = Path::new(export_dir).join(&new_name);
        if !new_path.exists() {
            return new_path.to_string_lossy().to_string();
        }
    }
    full_path.to_string_lossy().to_string()
}

fn merge_clip_to_file(
    clip_folder: &str,
    output_file: &Path,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let session_mpd_files = find_session_mpd_files(clip_folder);
    if session_mpd_files.is_empty() {
        return Err("No session.mpd files found".to_string());
    }
    let mut temp_video_paths = Vec::new();
    let mut temp_audio_paths = Vec::new();
    let mut extra_temps = Vec::new();
    let result = (|| {
        for session_mpd in &session_mpd_files {
            let data_dir = Path::new(session_mpd).parent().ok_or("Invalid path")?;
            temp_video_paths.push(concat_init_and_chunks(data_dir, 0, cancelled)?);
            temp_audio_paths.push(concat_init_and_chunks(data_dir, 1, cancelled)?);
        }
        let video = if temp_video_paths.len() == 1 {
            temp_video_paths[0].clone()
        } else {
            let path = concatenate_media_files(&temp_video_paths, true, cancelled)?;
            extra_temps.push(path.clone());
            path
        };
        let audio = if temp_audio_paths.len() == 1 {
            temp_audio_paths[0].clone()
        } else {
            let path = concatenate_media_files(&temp_audio_paths, false, cancelled)?;
            extra_temps.push(path.clone());
            path
        };
        let ffmpeg = ffmpeg_path()?;
        let mut cmd = create_command(&ffmpeg);
        cmd.args(["-y", "-i"])
            .arg(video)
            .args(["-i"])
            .arg(audio)
            .args(["-c", "copy"])
            .arg(output_file)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        run_command(&mut cmd, cancelled)
    })();
    for path in temp_video_paths
        .iter()
        .chain(temp_audio_paths.iter())
        .chain(extra_temps.iter())
    {
        let _ = fs::remove_file(path);
    }
    if result.is_err() {
        let _ = fs::remove_file(output_file);
    }
    result
}

pub async fn convert_single_clip(
    clip_folder: &str,
    export_dir: &str,
    game_ids: &HashMap<String, String>,
    cancelled: Arc<AtomicBool>,
) -> Result<String, String> {
    let clip_folder = clip_folder.to_string();
    let export_dir = export_dir.to_string();
    let game_ids = game_ids.clone();
    tokio::task::spawn_blocking(move || {
        let output_filename = generate_output_filename(&clip_folder, &game_ids)?;
        let output_file = get_unique_filename(&export_dir, &output_filename);
        let output_path = Path::new(&output_file);
        let temp_file = output_path.with_file_name(format!(
            ".{}.{}.tmp",
            output_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("export.mp4"),
            uuid::Uuid::new_v4()
        ));
        let result = merge_clip_to_file(&clip_folder, &temp_file, &cancelled)
            .and_then(|_| fs::rename(&temp_file, output_path).map_err(|e| e.to_string()));
        if result.is_err() {
            let _ = fs::remove_file(&temp_file);
        }
        result?;
        Ok(output_file)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::get_unique_filename;

    #[test]
    fn unique_output_does_not_use_existing_path() {
        let root = std::env::temp_dir().join(format!("rainy-export-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("clip.mp4"), [1]).unwrap();
        assert!(get_unique_filename(&root.to_string_lossy(), "clip.mp4").ends_with("clip_1.mp4"));
        std::fs::remove_dir_all(root).unwrap();
    }
}

pub fn extract_first_frame(
    session_mpd_path: &str,
    output_thumbnail_path: &str,
) -> Result<(), String> {
    let ffmpeg = ffmpeg_path()?;
    let mut child = create_command(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .arg("-i")
        .arg(session_mpd_path)
        .args(["-frames:v", "1", "-q:v", "2"])
        .arg(output_thumbnail_path)
        .stdout(std::process::Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let _job = match crate::process_job::ProcessJob::assign(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let result = child.wait_with_output().map_err(|e| e.to_string())?;
    if !result.status.success() {
        return Err(format!(
            "FFmpeg thumbnail extraction failed: {}",
            String::from_utf8_lossy(&result.stderr).trim()
        ));
    }
    Ok(())
}

pub fn prepare_preview(clip_folder: &str) -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    let preview_path = temp_dir.join(format!("rainy_preview_{}.mp4", uuid::Uuid::new_v4()));
    if preview_path.exists() {
        let _ = fs::remove_file(&preview_path);
    }
    let cancelled = AtomicBool::new(false);
    merge_clip_to_file(clip_folder, &preview_path, &cancelled)?;
    Ok(preview_path.to_string_lossy().to_string())
}

pub fn cleanup_preview(preview_path: &str) {
    let _ = fs::remove_file(preview_path);
}
