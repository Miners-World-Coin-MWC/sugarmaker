use crate::config::{save_workers, WorkerConfig};
use crate::sysinfo_util::{self, RigInfo};
use crate::worker::WorkerManager;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Serialize)]
struct RigSnapshot {
    rig: RigInfo,
    workers: Vec<WorkerConfig>,
    stats: std::collections::HashMap<String, crate::worker::WorkerStats>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action")]
enum Command {
    #[serde(rename = "start")]
    Start { worker_id: String },
    #[serde(rename = "stop")]
    Stop { worker_id: String },
    #[serde(rename = "upsert_worker")]
    UpsertWorker { config: WorkerConfig },
    #[serde(rename = "remove_worker")]
    RemoveWorker { worker_id: String },
}

/// Runs forever. Bind this on a port the dashboard is configured to reach
/// (default 4780). No auth here by design -- put this behind your own
/// network/VPN/tailnet; it is not meant to be exposed to the open internet.
pub async fn run(manager: Arc<WorkerManager>, port: u16) -> anyhow::Result<()> {
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;

    loop {
        let (stream, _addr) = listener.accept().await?;
        let manager = manager.clone();
        tokio::spawn(async move {
            if let Ok(ws_stream) = tokio_tungstenite::accept_async(stream).await {
                handle_connection(ws_stream, manager).await;
            }
        });
    }
}

async fn handle_connection(
    ws_stream: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    manager: Arc<WorkerManager>,
) {
    let (mut write, mut read) = ws_stream.split();
    let mut tick = tokio::time::interval(std::time::Duration::from_millis(1000));

    loop {
        tokio::select! {
            _ = tick.tick() => {
                let snapshot = RigSnapshot {
                    rig: sysinfo_util::snapshot(),
                    workers: manager.list_configs().await,
                    stats: manager.all_stats().await,
                };
                if let Ok(json) = serde_json::to_string(&snapshot) {
                    if write.send(Message::Text(json)).await.is_err() {
                        break;
                    }
                }
            }
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(cmd) = serde_json::from_str::<Command>(&text) {
                            handle_command(&manager, cmd).await;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }
}

async fn handle_command(manager: &Arc<WorkerManager>, cmd: Command) {
    match cmd {
        Command::Start { worker_id } => {
            let _ = manager.start(&worker_id).await;
        }
        Command::Stop { worker_id } => {
            manager.stop(&worker_id).await;
        }
        Command::UpsertWorker { config } => {
            manager.upsert_config(config).await;
            let _ = save_workers(&manager.list_configs().await);
        }
        Command::RemoveWorker { worker_id } => {
            manager.remove_config(&worker_id).await;
            let _ = save_workers(&manager.list_configs().await);
        }
    }
}
