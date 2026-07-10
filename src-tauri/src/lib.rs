// RainySteamRecord — Tauri backend
// Copyright (C) 2026 CATMIAOZHI
// Licensed under GPL-3.0. Portions based on SteamClip by Nastas95 (GPL-3.0).

mod sidecar;

use sidecar::SidecarManager;
use std::sync::Arc;
use tauri::Manager;

#[tauri::command]
async fn ping(name: String, state: tauri::State<'_, Arc<SidecarManager>>) -> Result<String, String> {
    // Forward to Node sidecar via JSON-RPC
    match state.request("ping", serde_json::json!({ "name": name })).await {
        Ok(resp) => serde_json::to_string(&resp).map_err(|e| e.to_string()),
        Err(e) => Err(e),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let manager = Arc::new(SidecarManager::new(app_handle));
            let manager_clone = manager.clone();
            // Spawn sidecar startup in background
            tauri::async_runtime::spawn(async move {
                if let Err(e) = manager_clone.start().await {
                    eprintln!("Failed to start sidecar: {e}");
                }
            });
            app.manage(manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}