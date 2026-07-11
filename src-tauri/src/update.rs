// RainySteamRecord — GitHub release update check
// Copyright (C) 2026 CATMIAOZHI
// Licensed under GPL-3.0.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseInfo {
    pub version: String,
    pub changelog: String,
    pub html_url: String,
}

pub async fn check_latest_release() -> Result<ReleaseInfo, String> {
    let url = "https://api.github.com/repos/CATMIAOZHI/RainySteamRecord/releases/latest";
    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .header("User-Agent", "RainySteamRecord-App")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(ReleaseInfo {
        version: json
            .get("tag_name")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string(),
        changelog: json
            .get("body")
            .and_then(|v| v.as_str())
            .unwrap_or("No changelog")
            .to_string(),
        html_url: json
            .get("html_url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

pub const CURRENT_VERSION: &str = "v0.2.0";
