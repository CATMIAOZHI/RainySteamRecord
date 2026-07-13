// RainySteamRecord — FFmpeg conversion logic
// Copyright (C) 2026 CATMIAOZHI
// Licensed under GPL-3.0. Portions based on SteamClip by Nastas95 (GPL-3.0).

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, OnceLock,
};
use std::time::{Duration, Instant};

#[derive(Debug, serde::Serialize)]
pub struct ExportPreflight {
    pub available_bytes: u64,
    pub estimated_required_bytes: u64,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExportPhase {
    Preparing,
    Copying,
    JoiningVideo,
    JoiningAudio,
    Muxing,
    Finalizing,
}

#[derive(Clone, Debug)]
pub struct ExportProgress {
    pub phase: ExportPhase,
    pub completed: Option<u64>,
    pub total: Option<u64>,
}

pub type ProgressCallback = Arc<dyn Fn(ExportProgress) + Send + Sync>;

struct StreamSources {
    files: Vec<PathBuf>,
    total_bytes: u64,
}

struct CopyProgress<'a> {
    callback: &'a ProgressCallback,
    completed: u64,
    total: u64,
    last_emit: Instant,
    last_bytes: u64,
}

impl CopyProgress<'_> {
    fn emit(&mut self, force: bool) {
        if force
            || self.last_emit.elapsed() >= Duration::from_millis(100)
            || self.completed.saturating_sub(self.last_bytes) >= 1024 * 1024
        {
            (self.callback)(ExportProgress {
                phase: ExportPhase::Copying,
                completed: Some(self.completed),
                total: Some(self.total),
            });
            self.last_emit = Instant::now();
            self.last_bytes = self.completed;
        }
    }
}

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

fn export_error(code: &str, detail: impl std::fmt::Display) -> String {
    format!("{}|{}", code, detail)
}

#[cfg(windows)]
fn available_space(path: &Path) -> Result<u64, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut available = 0u64;
    let result = unsafe {
        GetDiskFreeSpaceExW(
            path.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(available)
    }
}

#[cfg(not(windows))]
fn available_space(_path: &Path) -> Result<u64, String> {
    Ok(u64::MAX)
}

pub fn preflight_export(
    clip_folders: &[String],
    export_dir: &str,
) -> Result<ExportPreflight, String> {
    if clip_folders.is_empty() {
        return Err(export_error("EXPORT_NO_CLIPS", "No clips selected"));
    }
    let export_path = Path::new(export_dir);
    fs::create_dir_all(export_path).map_err(|error| export_error("EXPORT_DIR_CREATE", error))?;
    if !export_path.is_dir() {
        return Err(export_error(
            "EXPORT_DIR_INVALID",
            "Export path is not a directory",
        ));
    }
    let canonical_export = export_path
        .canonicalize()
        .map_err(|error| export_error("EXPORT_DIR_INVALID", error))?;
    let probe = canonical_export.join(format!(".rainy_write_test_{}", uuid::Uuid::new_v4()));
    let probe_result = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .and_then(|mut file| {
            file.write_all(b"test")?;
            file.sync_all()
        });
    let _ = fs::remove_file(&probe);
    probe_result.map_err(|error| export_error("EXPORT_DIR_NOT_WRITABLE", error))?;

    ffmpeg_path().map_err(|error| export_error("EXPORT_FFMPEG_MISSING", error))?;

    let mut source_bytes = 0u64;
    for folder in clip_folders {
        let path = Path::new(folder);
        if !path.is_dir() {
            return Err(export_error("EXPORT_SOURCE_MISSING", folder));
        }
        let canonical_source = path
            .canonicalize()
            .map_err(|error| export_error("EXPORT_SOURCE_MISSING", error))?;
        if canonical_export.starts_with(&canonical_source) {
            return Err(export_error("EXPORT_DIR_IN_SOURCE", export_dir));
        }
        if crate::streaming::find_session_mpd_paths(folder).is_empty() {
            return Err(export_error("EXPORT_SOURCE_INVALID", folder));
        }
        for entry in walkdir::WalkDir::new(&canonical_source) {
            let entry = entry.map_err(|error| export_error("EXPORT_SOURCE_UNREADABLE", error))?;
            if entry.file_type().is_file() {
                source_bytes = source_bytes.saturating_add(
                    entry
                        .metadata()
                        .map_err(|error| export_error("EXPORT_SOURCE_UNREADABLE", error))?
                        .len(),
                );
            }
        }
    }

    let estimated_required_bytes = source_bytes.saturating_mul(2).max(64 * 1024 * 1024);
    let available_bytes = available_space(&canonical_export)
        .map_err(|error| export_error("EXPORT_SPACE_CHECK_FAILED", error))?;
    if available_bytes < estimated_required_bytes {
        return Err(export_error(
            "EXPORT_SPACE_INSUFFICIENT",
            format!("{}|{}", estimated_required_bytes, available_bytes),
        ));
    }
    let temp_dir = std::env::temp_dir();
    let temp_available = available_space(&temp_dir)
        .map_err(|error| export_error("EXPORT_SPACE_CHECK_FAILED", error))?;
    if temp_available < estimated_required_bytes {
        return Err(export_error(
            "EXPORT_TEMP_SPACE_INSUFFICIENT",
            format!("{}|{}", estimated_required_bytes, temp_available),
        ));
    }

    Ok(ExportPreflight {
        available_bytes,
        estimated_required_bytes,
    })
}

fn find_session_mpd_files(clip_folder: &str) -> Vec<String> {
    crate::streaming::find_session_mpd_paths(clip_folder)
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

fn collect_stream_sources(data_dir: &Path, stream_num: u32) -> Result<StreamSources, String> {
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
    let files: Vec<PathBuf> = std::iter::once(init_file).chain(chunks).collect();
    let total_bytes = files.iter().try_fold(0u64, |total, path| {
        path.metadata()
            .map(|metadata| total.saturating_add(metadata.len()))
            .map_err(|error| error.to_string())
    })?;
    Ok(StreamSources { files, total_bytes })
}

fn concat_init_and_chunks(
    sources: &StreamSources,
    stream_num: u32,
    cancelled: &AtomicBool,
    progress: &mut CopyProgress<'_>,
) -> Result<PathBuf, String> {
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join(format!(
        "rainy_stream_{}_{}.mp4",
        stream_num,
        uuid::Uuid::new_v4()
    ));
    let result = (|| {
        let mut file = fs::File::create(&temp_file).map_err(|e| e.to_string())?;
        let mut buffer = vec![0u8; 256 * 1024];
        for source in &sources.files {
            let mut input = fs::File::open(source).map_err(|e| e.to_string())?;
            loop {
                if cancelled.load(Ordering::Acquire) {
                    return Err("Conversion cancelled".to_string());
                }
                let read = input.read(&mut buffer).map_err(|e| e.to_string())?;
                if read == 0 {
                    break;
                }
                file.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
                progress.completed = progress.completed.saturating_add(read as u64);
                progress.emit(false);
            }
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
    cmd.args(["-f", "concat", "-safe", "0", "-i"])
        .arg(&list_file)
        .args(["-c", "copy"]);
    if is_video {
        cmd.args(["-movflags", "+faststart", "-max_muxing_queue_size", "1024"]);
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

#[allow(dead_code)]
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

fn reserve_unique_filename(export_dir: &str, filename: &str) -> Result<(String, Vec<u8>), String> {
    let export_path = Path::new(export_dir);
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = Path::new(filename)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mp4");
    let mut i = 0;
    loop {
        let name = if i == 0 {
            filename.to_string()
        } else {
            format!("{}_{}.{}", stem, i, ext)
        };
        let path = export_path.join(&name);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                use std::io::Write;
                let token = format!("rainy-reservation:{}", uuid::Uuid::new_v4()).into_bytes();
                if let Err(e) = file.write_all(&token) {
                    let _ = fs::remove_file(&path);
                    return Err(format!("Failed to write reservation token: {}", e));
                }
                if let Err(e) = file.sync_all() {
                    let _ = fs::remove_file(&path);
                    return Err(format!("Failed to sync reservation: {}", e));
                }
                return Ok((path.to_string_lossy().to_string(), token));
            }
            Err(e) => {
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    i += 1;
                    if i >= 1000 {
                        return Err(
                            "Could not find a unique filename after 1000 attempts".to_string()
                        );
                    }
                    continue;
                } else {
                    return Err(format!("Failed to create placeholder file: {}", e));
                }
            }
        }
    }
}

fn reservation_matches(path: &Path, token: &[u8]) -> bool {
    std::fs::read(path).is_ok_and(|content| content == token)
}

fn remove_reservation(path: &Path, token: &[u8]) {
    if reservation_matches(path, token) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(windows)]
fn commit_output(source: &Path, destination: &Path) -> Result<(), String> {
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
fn commit_output(source: &Path, destination: &Path) -> Result<(), String> {
    std::fs::rename(source, destination).map_err(|e| e.to_string())
}

fn merge_clip_to_file(
    clip_folder: &str,
    output_file: &Path,
    cancelled: &AtomicBool,
    progress_callback: &ProgressCallback,
) -> Result<(), String> {
    let session_mpd_files = find_session_mpd_files(clip_folder);
    if session_mpd_files.is_empty() {
        return Err("No session.mpd files found".to_string());
    }
    let mut temp_video_paths = Vec::new();
    let mut temp_audio_paths = Vec::new();
    let mut extra_temps = Vec::new();
    let result = (|| {
        let sources = session_mpd_files
            .iter()
            .map(|session_mpd| {
                let data_dir = Path::new(session_mpd).parent().ok_or("Invalid path")?;
                Ok((
                    collect_stream_sources(data_dir, 0)?,
                    collect_stream_sources(data_dir, 1)?,
                ))
            })
            .collect::<Result<Vec<_>, String>>()?;
        let total = sources.iter().fold(0u64, |sum, (video, audio)| {
            sum.saturating_add(video.total_bytes)
                .saturating_add(audio.total_bytes)
        });
        let mut copy_progress = CopyProgress {
            callback: progress_callback,
            completed: 0,
            total,
            last_emit: Instant::now(),
            last_bytes: 0,
        };
        copy_progress.emit(true);
        for (video_sources, audio_sources) in &sources {
            temp_video_paths.push(concat_init_and_chunks(
                video_sources,
                0,
                cancelled,
                &mut copy_progress,
            )?);
            temp_audio_paths.push(concat_init_and_chunks(
                audio_sources,
                1,
                cancelled,
                &mut copy_progress,
            )?);
        }
        copy_progress.emit(true);
        let video = if temp_video_paths.len() == 1 {
            temp_video_paths[0].clone()
        } else {
            (progress_callback)(ExportProgress {
                phase: ExportPhase::JoiningVideo,
                completed: None,
                total: None,
            });
            let path = concatenate_media_files(&temp_video_paths, true, cancelled)?;
            extra_temps.push(path.clone());
            path
        };
        let audio = if temp_audio_paths.len() == 1 {
            temp_audio_paths[0].clone()
        } else {
            (progress_callback)(ExportProgress {
                phase: ExportPhase::JoiningAudio,
                completed: None,
                total: None,
            });
            let path = concatenate_media_files(&temp_audio_paths, false, cancelled)?;
            extra_temps.push(path.clone());
            path
        };
        (progress_callback)(ExportProgress {
            phase: ExportPhase::Muxing,
            completed: None,
            total: None,
        });
        let ffmpeg = ffmpeg_path()?;
        let mut cmd = create_command(&ffmpeg);
        cmd.args(["-y", "-i"])
            .arg(video)
            .args(["-i"])
            .arg(audio)
            .args(["-c", "copy", "-f", "mp4"])
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
    progress: ProgressCallback,
) -> Result<String, String> {
    let clip_folder = clip_folder.to_string();
    let export_dir = export_dir.to_string();
    let game_ids = game_ids.clone();
    tokio::task::spawn_blocking(move || {
        (progress)(ExportProgress {
            phase: ExportPhase::Preparing,
            completed: None,
            total: None,
        });
        let output_filename = generate_output_filename(&clip_folder, &game_ids)?;
        let (output_file, reservation_token) =
            reserve_unique_filename(&export_dir, &output_filename)?;
        let output_path = Path::new(&output_file);
        let temp_file = output_path.with_file_name(format!(
            ".{}.{}.tmp.mp4",
            output_path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("export"),
            uuid::Uuid::new_v4()
        ));
        if let Err(error) = merge_clip_to_file(&clip_folder, &temp_file, &cancelled, &progress) {
            let _ = fs::remove_file(&temp_file);
            remove_reservation(output_path, &reservation_token);
            return Err(error);
        }
        if !reservation_matches(output_path, &reservation_token) {
            let _ = fs::remove_file(&temp_file);
            return Err("Reserved output path was replaced by another process".to_string());
        }
        if cancelled.load(Ordering::Acquire) {
            let _ = fs::remove_file(&temp_file);
            remove_reservation(output_path, &reservation_token);
            return Err("Conversion cancelled".to_string());
        }
        (progress)(ExportProgress {
            phase: ExportPhase::Finalizing,
            completed: None,
            total: None,
        });
        if cancelled.load(Ordering::Acquire) {
            let _ = fs::remove_file(&temp_file);
            remove_reservation(output_path, &reservation_token);
            return Err("Conversion cancelled".to_string());
        }
        if let Err(error) = commit_output(&temp_file, output_path) {
            let _ = fs::remove_file(&temp_file);
            remove_reservation(output_path, &reservation_token);
            return Err(error);
        }
        Ok(output_file)
    })
    .await
    .map_err(|e| e.to_string())?
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
    let progress: ProgressCallback = Arc::new(|_| {});
    merge_clip_to_file(clip_folder, &preview_path, &cancelled, &progress)?;
    Ok(preview_path.to_string_lossy().to_string())
}

pub fn cleanup_preview(preview_path: &str) {
    let path = Path::new(preview_path);
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !file_name.starts_with("rainy_preview_") || !file_name.ends_with(".mp4") {
        return;
    }
    let temp_dir = std::env::temp_dir();
    if let Ok(canonical) = path.canonicalize() {
        if let Ok(temp_canonical) = temp_dir.canonicalize() {
            if !canonical.starts_with(&temp_canonical) {
                return;
            }
        }
    }
    let _ = fs::remove_file(preview_path);
}

#[cfg(test)]
mod tests {
    use super::{commit_output, preflight_export, reservation_matches, reserve_unique_filename};

    #[test]
    fn preflight_rejects_empty_and_missing_sources() {
        let root =
            std::env::temp_dir().join(format!("rainy-preflight-test-{}", uuid::Uuid::new_v4()));
        assert!(preflight_export(&[], &root.to_string_lossy())
            .unwrap_err()
            .starts_with("EXPORT_NO_CLIPS|"));
        let missing = root.join("missing").to_string_lossy().to_string();
        assert!(preflight_export(&[missing], &root.to_string_lossy())
            .unwrap_err()
            .starts_with("EXPORT_SOURCE_MISSING|"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unique_output_does_not_use_existing_path() {
        let root = std::env::temp_dir().join(format!("rainy-export-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("clip.mp4"), [1]).unwrap();
        let (reserved, token) =
            reserve_unique_filename(&root.to_string_lossy(), "clip.mp4").unwrap();
        assert!(reserved.ends_with("clip_1.mp4"));
        assert!(std::path::Path::new(&reserved).exists());
        assert!(reservation_matches(std::path::Path::new(&reserved), &token));
        std::fs::remove_file(reserved).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn commit_output_replaces_reserved_file() {
        let root = std::env::temp_dir().join(format!("rainy-commit-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let destination = root.join("clip.mp4");
        let source = root.join("clip.tmp.mp4");
        std::fs::write(&destination, []).unwrap();
        std::fs::write(&source, [1, 2, 3]).unwrap();
        commit_output(&source, &destination).unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), [1, 2, 3]);
        assert!(!source.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
