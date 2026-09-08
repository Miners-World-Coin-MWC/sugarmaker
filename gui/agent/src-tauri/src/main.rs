#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod parser;
mod sysinfo_util;
mod worker;
mod ws_server;

use config::{load_workers, save_workers, WorkerConfig};
use std::collections::HashMap;
use std::sync::Arc;
use sysinfo_util::RigInfo;
use tauri::{Manager, State};
use worker::{WorkerManager, WorkerStats};

/// Dashboard WebSocket port used by the agent.
pub const DASHBOARD_PORT: u16 = 4780;

struct AppState {
    manager: Arc<WorkerManager>,
}

#[derive(Debug, Clone, serde::Serialize)]
struct DashboardConnection {
    ip: String,
    port: u16,
    websocket_url: String,
}

#[tauri::command]
async fn list_workers(state: State<'_, AppState>) -> Result<Vec<WorkerConfig>, String> {
    Ok(state.manager.list_configs().await)
}

#[tauri::command]
async fn get_stats(
    state: State<'_, AppState>,
) -> Result<HashMap<String, WorkerStats>, String> {
    Ok(state.manager.all_stats().await)
}

#[tauri::command]
async fn get_rig_info() -> Result<RigInfo, String> {
    Ok(sysinfo_util::snapshot())
}

#[tauri::command]
async fn get_dashboard_connection() -> Result<DashboardConnection, String> {
    let ip = detect_local_ip();

    Ok(DashboardConnection {
        websocket_url: format!("ws://{}:{}", ip, DASHBOARD_PORT),
        ip,
        port: DASHBOARD_PORT,
    })
}

#[tauri::command]
async fn upsert_worker(
    state: State<'_, AppState>,
    config: WorkerConfig,
) -> Result<(), String> {
    state.manager.upsert_config(config).await;

    save_workers(&state.manager.list_configs().await)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn remove_worker(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.manager.remove_config(&id).await;

    save_workers(&state.manager.list_configs().await)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_worker(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.manager.start(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn stop_worker(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.manager.stop(&id).await;
    Ok(())
}

/// Detect the local IPv4 address used for network connections.
///
/// This does not actually send data to the target address. Connecting a UDP
/// socket lets the operating system select the appropriate local interface.
fn detect_local_ip() -> String {
    use std::net::UdpSocket;

    match UdpSocket::bind("0.0.0.0:0")
        .and_then(|socket| {
            socket.connect("8.8.8.8:80")?;
            socket.local_addr()
        }) {
        Ok(addr) => addr.ip().to_string(),
        Err(_) => "127.0.0.1".to_string(),
    }
}

fn main() {
    let initial_workers = load_workers();

    let manager = WorkerManager::new(initial_workers.clone());
    let manager_for_setup = manager.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState { manager })
        .setup(move |app| {
            // Resource dir is only known once the app is built, hence doing
            // this here rather than before tauri::Builder::default().
            if let Ok(resource_dir) = app.path().resource_dir() {
                config::set_resource_dir(resource_dir);
            }

            let manager_for_bg = manager_for_setup.clone();
            let workers = initial_workers.clone();

            tauri::async_runtime::spawn(async move {
                // Start workers configured for autostart.
                for cfg in workers {
                    if cfg.autostart {
                        let _ = manager_for_bg.start(&cfg.id).await;
                    }
                }

                // Start the dashboard WebSocket server.
                let _ = ws_server::run(
                    manager_for_bg,
                    DASHBOARD_PORT,
                )
                .await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_workers,
            get_stats,
            get_rig_info,
            get_dashboard_connection,
            upsert_worker,
            remove_worker,
            start_worker,
            stop_worker,
        ])
        .run(tauri::generate_context!())
        .expect("error while running sugarmaker-agent");
}
