use std::path::PathBuf;
use std::process::{Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

fn mpv_path() -> Result<PathBuf, String> {
    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(parent) = exe_dir.parent() {
            for candidate in [
                parent.join("mpv.exe"),
                parent.join("binaries").join("mpv.exe"),
                parent.join("resources").join("mpv.exe"),
            ] {
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join("mpv.exe");
    if development.is_file() {
        return Ok(development);
    }
    Err("mpv.exe not found".to_string())
}

pub fn open_preview(clip_folder: &str, title: &str) -> Result<(), String> {
    let mpd_paths = crate::streaming::find_session_mpd_paths(clip_folder);
    if mpd_paths.is_empty() {
        return Err("No session.mpd files found".to_string());
    }
    let mut command = Command::new(mpv_path()?);
    command
        .args([
            "--no-config",
            "--force-window=yes",
            "--keep-open=no",
            "--hwdec=auto-safe",
            "--input-default-bindings=yes",
            "--osc=yes",
            "--osd-level=1",
            "--no-terminal",
        ])
        .arg(format!("--title={title}"));
    for mpd in &mpd_paths {
        command.arg(mpd);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let job = match crate::process_job::ProcessJob::assign(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    std::thread::spawn(move || {
        let _job = job;
        let _ = child.wait();
    });
    Ok(())
}
