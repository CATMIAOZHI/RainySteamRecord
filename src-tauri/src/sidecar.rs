// RainySteamRecord — Sidecar process manager (Rust ↔ Node JSON-RPC over stdio)
// Copyright (C) 2026 CATMIAOZHI
// Licensed under GPL-3.0.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

type PendingRequests = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

#[derive(Serialize, Deserialize)]
struct RpcRequest {
    jsonrpc: String,
    id: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize, Deserialize)]
struct RpcResponse {
    #[serde(default)]
    id: Option<u64>,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<Value>,
    #[serde(default)]
    event: Option<String>,
    #[serde(default)]
    data: Option<Value>,
}

pub struct SidecarManager {
    app: AppHandle,
    stdin: AsyncMutex<Option<ChildStdin>>,
    child: AsyncMutex<Option<Child>>,
    next_id: AtomicU64,
    pending: PendingRequests,
}

impl SidecarManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            stdin: AsyncMutex::new(None),
            child: AsyncMutex::new(None),
            next_id: AtomicU64::new(1),
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start(&self) -> Result<(), String> {
        let sidecar_path = self
            .app
            .path()
            .resolve("binaries/rainy-sidecar", tauri::path::BaseDirectory::Resource)
            .map_err(|e| format!("resolve sidecar path: {e}"))?
            .to_string_lossy()
            .to_string();

        let mut child = Command::new(&sidecar_path)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .windows_hide(true)
            .spawn()
            .map_err(|e| format!("spawn sidecar: {e}"))?;

        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;

        // Spawn reader thread to handle responses and events
        let app = self.app.clone();
        let pending = self.pending.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.is_empty() {
                    continue;
                }
                match serde_json::from_str::<RpcResponse>(&line) {
                    Ok(resp) => {
                        // Check if it's a response (has id) or an event (has event field)
                        if let Some(id) = resp.id {
                            if let Some(sender) = {
                                let mut p = pending.lock().unwrap();
                                p.remove(&id)
                            } {
                                let result = resp.result.unwrap_or(resp.error.unwrap_or(Value::Null));
                                let _ = sender.send(result);
                            }
                        } else if let Some(event_name) = resp.event {
                            let _ = app.emit("sidecar-event", format!("{event_name}: {}", resp.data.unwrap_or(Value::Null)));
                        }
                    }
                    Err(e) => {
                        eprintln!("sidecar parse error: {e} — line: {line}");
                    }
                }
            }
        });

        *self.stdin.lock().await = Some(stdin);
        *self.child.lock().await = Some(child);
        Ok(())
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = RpcRequest {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.to_string(),
            params,
        };
        let line = serde_json::to_string(&req).map_err(|e| e.to_string())?;

        let (tx, rx) = oneshot::channel();
        {
            let mut p = self.pending.lock().unwrap();
            p.insert(id, tx);
        }

        {
            let mut stdin_guard = self.stdin.lock().await;
            if let Some(stdin) = stdin_guard.as_mut() {
                stdin
                    .write_all(format!("{line}\n").as_bytes())
                    .await
                    .map_err(|e| format!("write to sidecar: {e}"))?;
                stdin.flush().await.map_err(|e| format!("flush sidecar: {e}"))?;
            } else {
                return Err("sidecar not started".to_string());
            }
        }

        tokio::time::timeout(std::time::Duration::from_secs(30), rx)
            .await
            .map_err(|_| "sidecar request timeout".to_string())?
            .map_err(|_| "sidecar response channel closed".to_string())
    }
}