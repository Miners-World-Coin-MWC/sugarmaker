#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ws_client;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use ws_client::{DashboardState, RigConnectionState, RigEntry};

struct AppState {
    dashboard: Arc<DashboardState>,
}

fn rigs_path() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("sugarmaker-gui");
    let _ = fs::create_dir_all(&dir);
    dir.join("rigs.json")
}

fn load_rigs() -> Vec<RigEntry> {
    if let Ok(bytes) = fs::read(rigs_path()) {
        if let Ok(list) = serde_json::from_slice::<Vec<RigEntry>>(&bytes) {
            return list;
        }
    }
    vec![]
}

fn save_rigs(rigs: &[RigEntry]) {
    if let Ok(bytes) = serde_json::to_vec_pretty(rigs) {
        let _ = fs::write(rigs_path(), bytes);
    }
}

#[tauri::command]
async fn list_rigs(state: State<'_, AppState>) -> Result<Vec<RigEntry>, String> {
    Ok(state.dashboard.rigs.read().await.values().cloned().collect())
}

#[tauri::command]
async fn add_rig(state: State<'_, AppState>, label: String, address: String) -> Result<(), String> {
    let rig = RigEntry {
        id: uuid_v4(),
        label,
        address,
    };
    state.dashboard.add_rig(rig).await;
    let all: Vec<RigEntry> = state.dashboard.rigs.read().await.values().cloned().collect();
    save_rigs(&all);
    Ok(())
}

#[tauri::command]
async fn remove_rig(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.dashboard.remove_rig(&id).await;
    let all: Vec<RigEntry> = state.dashboard.rigs.read().await.values().cloned().collect();
    save_rigs(&all);
    Ok(())
}

#[tauri::command]
async fn get_connections(
    state: State<'_, AppState>,
) -> Result<HashMap<String, RigConnectionState>, String> {
    Ok(state.dashboard.snapshot_all().await)
}

#[derive(Deserialize)]
struct RemoteAction {
    rig_id: String,
    worker_id: String,
    action: String, // "start" | "stop"
}

#[tauri::command]
async fn control_remote_worker(state: State<'_, AppState>, req: RemoteAction) -> Result<(), String> {
    let payload = serde_json::json!({ "action": req.action, "worker_id": req.worker_id });
    state
        .dashboard
        .send_command(&req.rig_id, payload.to_string())
        .await
        .map_err(|e| e.to_string())
}

fn uuid_v4() -> String {
    // tiny dependency-free uuid v4 (dashboard doesn't need the full uuid crate)
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    format!("{:032x}", nanos)
}

fn main() {
    let rigs = load_rigs();
    let dashboard = DashboardState::new(rigs.clone());
    for rig in rigs {
        dashboard.spawn_connection(rig);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState { dashboard })
        .invoke_handler(tauri::generate_handler![
            list_rigs,
            add_rig,
            remove_rig,
            get_connections,
            control_remote_worker,
        ])
        .run(tauri::generate_context!())
        .expect("error while running sugarmaker-dashboard");
}
