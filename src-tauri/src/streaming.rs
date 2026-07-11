use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct SessionInfo {
    pub session_dir: String,
    pub duration_seconds: f64,
    pub segment_duration_seconds: f64,
    pub video_codec: String,
    pub audio_codec: String,
    pub video_init: String,
    pub audio_init: String,
    pub video_chunks: Vec<String>,
    pub audio_chunks: Vec<String>,
}

#[derive(Serialize)]
pub struct ClipStreamInfo {
    pub duration_seconds: f64,
    pub sessions: Vec<SessionInfo>,
}

#[derive(Debug, Clone, Default)]
pub struct MpdMetadata {
    pub duration_seconds: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub frame_rate: Option<f64>,
}

pub(crate) fn segment_number(name: &str) -> Option<u32> {
    let stem = name.strip_suffix(".m4s")?;
    let (stream, number) = stem.rsplit_once('-')?;
    let stream_number = stream.strip_prefix("chunk-stream")?;
    if stream_number.is_empty() || !stream_number.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if number.is_empty() || !number.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    number.parse().ok()
}

pub(crate) fn segment_sort(a: &str, b: &str) -> std::cmp::Ordering {
    match (segment_number(a), segment_number(b)) {
        (Some(a_number), Some(b_number)) => a_number.cmp(&b_number).then_with(|| a.cmp(b)),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a.cmp(b),
    }
}

pub fn find_session_mpd_paths(clip_folder: &str) -> Vec<PathBuf> {
    let root_mpd = Path::new(clip_folder).join("session.mpd");
    if root_mpd.is_file() {
        return vec![root_mpd];
    }
    let mut files = Vec::new();
    fn walk_dir(dir: &Path, files: &mut Vec<PathBuf>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk_dir(&path, files);
                } else if path
                    .file_name()
                    .map(|n| n == "session.mpd")
                    .unwrap_or(false)
                {
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

fn extract_attribute(content: &str, name: &str) -> Option<String> {
    let marker = format!("{}=\"", name);
    let rest = content.split_once(&marker)?.1;
    Some(rest.split_once('"')?.0.to_string())
}

pub(crate) fn parse_iso8601_duration(value: &str) -> f64 {
    let mut total = 0.0;
    let mut number = String::new();
    for ch in value.strip_prefix("PT").unwrap_or(value).chars() {
        if ch.is_ascii_digit() || ch == '.' {
            number.push(ch);
            continue;
        }
        if let Ok(value) = number.parse::<f64>() {
            match ch {
                'H' => total += value * 3600.0,
                'M' => total += value * 60.0,
                'S' => total += value,
                _ => {}
            }
        }
        number.clear();
    }
    total
}

fn parse_frame_rate(value: &str) -> Option<f64> {
    if let Some((numerator, denominator)) = value.split_once('/') {
        let numerator = numerator.parse::<f64>().ok()?;
        let denominator = denominator.parse::<f64>().ok()?;
        return (denominator > 0.0).then_some(numerator / denominator);
    }
    value.parse().ok()
}

fn tags<'a>(content: &'a str, name: &str) -> Vec<&'a str> {
    let marker = format!("<{}", name);
    content
        .split(&marker)
        .skip(1)
        .filter_map(|rest| rest.split_once('>').map(|(tag, _)| tag))
        .collect()
}

pub fn parse_mpd_metadata(content: &str) -> Result<MpdMetadata, String> {
    if !content.contains("<MPD") {
        return Err("Invalid MPD document".to_string());
    }
    let duration_seconds = extract_attribute(content, "mediaPresentationDuration")
        .map(|value| parse_iso8601_duration(&value))
        .unwrap_or(0.0);
    let mut metadata = MpdMetadata {
        duration_seconds,
        video_codec: extract_codec(content, "video"),
        audio_codec: extract_codec(content, "audio"),
        ..MpdMetadata::default()
    };
    for tag in tags(content, "Representation") {
        let mime_type = extract_attribute(tag, "mimeType").unwrap_or_default();
        let codec = extract_attribute(tag, "codecs");
        let is_video = mime_type.starts_with("video/")
            || extract_attribute(tag, "width").is_some()
            || codec.as_deref().is_some_and(|value| {
                value.starts_with("avc") || value.starts_with("hev") || value.starts_with("hvc")
            });
        if is_video {
            metadata.width = metadata
                .width
                .or_else(|| extract_attribute(tag, "width").and_then(|value| value.parse().ok()));
            metadata.height = metadata
                .height
                .or_else(|| extract_attribute(tag, "height").and_then(|value| value.parse().ok()));
            metadata.frame_rate = metadata.frame_rate.or_else(|| {
                extract_attribute(tag, "frameRate").and_then(|value| parse_frame_rate(&value))
            });
            metadata.video_codec = metadata.video_codec.or(codec);
        } else if mime_type.starts_with("audio/") {
            metadata.audio_codec = metadata.audio_codec.or(codec);
        }
    }
    for tag in tags(content, "AdaptationSet") {
        let content_type = extract_attribute(tag, "contentType").unwrap_or_default();
        if content_type == "video" {
            metadata.video_codec = metadata
                .video_codec
                .or_else(|| extract_attribute(tag, "codecs"));
            metadata.width = metadata
                .width
                .or_else(|| extract_attribute(tag, "width").and_then(|value| value.parse().ok()));
            metadata.height = metadata
                .height
                .or_else(|| extract_attribute(tag, "height").and_then(|value| value.parse().ok()));
            metadata.frame_rate = metadata.frame_rate.or_else(|| {
                extract_attribute(tag, "frameRate").and_then(|value| parse_frame_rate(&value))
            });
        } else if content_type == "audio" {
            metadata.audio_codec = metadata
                .audio_codec
                .or_else(|| extract_attribute(tag, "codecs"));
        }
    }
    Ok(metadata)
}

fn extract_segment_duration(mpd_content: &str) -> f64 {
    let segment_template = mpd_content
        .split_once("<SegmentTemplate")
        .and_then(|(_, rest)| rest.split_once('>'))
        .map(|(tag, _)| tag)
        .unwrap_or("");
    let duration =
        extract_attribute(segment_template, "duration").and_then(|value| value.parse::<f64>().ok());
    let timescale = extract_attribute(segment_template, "timescale")
        .and_then(|value| value.parse::<f64>().ok());
    match (duration, timescale) {
        (Some(duration), Some(timescale)) if timescale > 0.0 => duration / timescale,
        _ => 3.0,
    }
}

fn collect_chunks(session_dir: &Path) -> (Vec<String>, Vec<String>) {
    let mut video_chunks: Vec<PathBuf> = Vec::new();
    let mut audio_chunks: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(session_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if segment_number(&name).is_none() {
                continue;
            }
            if name.starts_with("chunk-stream0-") {
                video_chunks.push(entry.path());
            } else if name.starts_with("chunk-stream1-") {
                audio_chunks.push(entry.path());
            }
        }
    }
    let sort_chunks = |chunks: &mut Vec<PathBuf>| {
        chunks.sort_by(|a, b| {
            segment_sort(
                &a.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
                &b.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
            )
        })
    };
    sort_chunks(&mut video_chunks);
    sort_chunks(&mut audio_chunks);
    let stringify = |chunks: Vec<PathBuf>| {
        chunks
            .into_iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect()
    };
    (stringify(video_chunks), stringify(audio_chunks))
}

pub fn get_clip_stream_info(clip_folder: &str) -> Result<ClipStreamInfo, String> {
    let session_dirs = find_session_dirs(clip_folder);
    if session_dirs.is_empty() {
        return Err("No session.mpd files found".to_string());
    }
    let mut sessions = Vec::new();
    let mut duration_seconds = 0.0;
    for dir in &session_dirs {
        let mpd_path = dir.join("session.mpd");
        let mpd_content =
            fs::read_to_string(&mpd_path).map_err(|e| format!("Failed to read MPD: {}", e))?;
        let metadata = parse_mpd_metadata(&mpd_content)?;
        let video_codec = metadata
            .video_codec
            .unwrap_or_else(|| "avc1.42E01E".to_string());
        let audio_codec = metadata
            .audio_codec
            .unwrap_or_else(|| "mp4a.40.2".to_string());
        let mut session_duration = metadata.duration_seconds;
        let segment_duration = extract_segment_duration(&mpd_content);
        let video_init = dir.join("init-stream0.m4s").to_string_lossy().to_string();
        let audio_init = dir.join("init-stream1.m4s").to_string_lossy().to_string();
        let (video_chunks, audio_chunks) = collect_chunks(dir);
        if session_duration <= 0.0 {
            session_duration = video_chunks.len() as f64 * segment_duration;
        }
        sessions.push(SessionInfo {
            session_dir: dir.to_string_lossy().to_string(),
            duration_seconds: session_duration,
            segment_duration_seconds: segment_duration,
            video_codec,
            audio_codec,
            video_init,
            audio_init,
            video_chunks,
            audio_chunks,
        });
        duration_seconds += session_duration;
    }
    Ok(ClipStreamInfo {
        duration_seconds,
        sessions,
    })
}

pub fn read_segment_bytes(file_path: &str) -> Result<Vec<u8>, String> {
    const MAX_SEGMENT_SIZE: u64 = 64 * 1024 * 1024;
    let size = fs::metadata(file_path)
        .map_err(|e| format!("Failed to inspect segment: {}", e))?
        .len();
    if size > MAX_SEGMENT_SIZE {
        return Err("Segment exceeds 64 MiB limit".to_string());
    }
    let data = fs::read(file_path).map_err(|e| format!("Failed to read segment: {}", e))?;
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::{
        extract_segment_duration, parse_iso8601_duration, parse_mpd_metadata, segment_number,
        segment_sort,
    };

    #[test]
    fn parses_stream_timing() {
        assert!((parse_iso8601_duration("PT16M25.95S") - 985.95).abs() < f64::EPSILON);
        assert_eq!(
            extract_segment_duration(
                r#"<SegmentTemplate timescale="1000000" duration="3000000"/>"#
            ),
            3.0
        );
    }

    #[test]
    fn parses_video_metadata_and_fractional_frame_rate() {
        let metadata = parse_mpd_metadata(r#"<MPD mediaPresentationDuration="PT1M2.5S"><Period><AdaptationSet contentType="video" codecs="hev1.1.6.L93"><Representation width="1920" height="1080" frameRate="30000/1001" /></AdaptationSet><AdaptationSet contentType="audio" codecs="mp4a.40.2" /></Period></MPD>"#).unwrap();
        assert_eq!(metadata.width, Some(1920));
        assert_eq!(metadata.height, Some(1080));
        assert!((metadata.frame_rate.unwrap() - 29.97002997).abs() < 0.000001);
        assert_eq!(metadata.video_codec.as_deref(), Some("hev1.1.6.L93"));
        assert_eq!(metadata.audio_codec.as_deref(), Some("mp4a.40.2"));
        assert_eq!(metadata.duration_seconds, 62.5);
    }

    #[test]
    fn sorts_steam_segment_numbers() {
        let mut names = vec![
            "chunk-stream0-00010.m4s",
            "chunk-stream0-00002.m4s",
            "chunk-stream0-00001.m4s",
        ];

        names.sort_by(|a, b| segment_sort(a, b));

        assert_eq!(
            names,
            vec![
                "chunk-stream0-00001.m4s",
                "chunk-stream0-00002.m4s",
                "chunk-stream0-00010.m4s",
            ]
        );
    }

    #[test]
    fn rejects_malformed_segment_names() {
        assert_eq!(segment_number("chunk-stream0-00001.m4s"), Some(1));
        assert_eq!(segment_number("chunk-stream0-bad.m4s"), None);
        assert_eq!(segment_number("chunk-stream0--1.m4s"), None);
        assert_eq!(segment_number("chunk-stream-00001.m4s"), None);
        assert_eq!(segment_number("chunk-stream0-4294967296.m4s"), None);
    }

    #[test]
    fn sorts_malformed_names_after_valid_segments() {
        let mut names = vec![
            "chunk-stream0-bad.m4s",
            "chunk-stream0-00002.m4s",
            "chunk-stream0-00001.m4s",
        ];

        names.sort_by(|a, b| segment_sort(a, b));

        assert_eq!(
            names,
            vec![
                "chunk-stream0-00001.m4s",
                "chunk-stream0-00002.m4s",
                "chunk-stream0-bad.m4s",
            ]
        );
    }
}
