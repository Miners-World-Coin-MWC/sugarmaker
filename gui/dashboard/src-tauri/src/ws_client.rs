use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RigEntry {
    pub id: String,
    pub label: String,
    /// e.g. "192.168.1.42:4780" -- the rig agent's ws_server address
    pub address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RigConnectionState {
    pub connected: bool,
    pub last_error: Option<String>,
    /// raw JSON snapshot forwarded straight from the rig agent's ws_server
    pub last_snapshot: Option<serde_json::Value>,
}

pub struct DashboardState {
    pub rigs: RwLock<HashMap<String, RigEntry>>,
    pub connection: RwLock<HashMap<String, RigConnectionState>>,
    /// per-rig outbound command channel, wired up once a connection is live
    command_tx: RwLock<HashMap<String, mpsc::UnboundedSender<String>>>,
}

impl DashboardState {
    pub fn new(rigs: Vec<RigEntry>) -> Arc<Self> {
        let mut map = HashMap::new();
        let mut conn = HashMap::new();
        for r in rigs {
            conn.insert(r.id.clone(), RigConnectionState::default());
            map.insert(r.id.clone(), r);
        }
        Arc::new(Self {
            rigs: RwLock::new(map),
            connection: RwLock::new(conn),
            command_tx: RwLock::new(HashMap::new()),
        })
    }

    pub async fn add_rig(self: &Arc<Self>, rig: RigEntry) {
        self.connection
            .write()
            .await
            .insert(rig.id.clone(), RigConnectionState::default());
        self.rigs.write().await.insert(rig.id.clone(), rig.clone());
        self.spawn_connection(rig);
    }

    pub async fn remove_rig(&self, id: &str) {
        self.rigs.write().await.remove(id);
        self.connection.write().await.remove(id);
        self.command_tx.write().await.remove(id);
    }

    pub async fn snapshot_all(&self) -> HashMap<String, RigConnectionState> {
        self.connection.read().await.clone()
    }

    /// Forward a raw command JSON (already shaped for the agent's ws_server) to one rig.
    pub async fn send_command(&self, rig_id: &str, command_json: String) -> anyhow::Result<()> {
        let tx = self
            .command_tx
            .read()
            .await
            .get(rig_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("rig not connected"))?;
        tx.send(command_json)?;
        Ok(())
    }

    pub fn spawn_connection(self: &Arc<Self>, rig: RigEntry) {
        let state = self.clone();
        tokio::spawn(async move {
            loop {
                let url = format!("ws://{}", rig.address);
                match tokio_tungstenite::connect_async(&url).await {
                    Ok((ws_stream, _)) => {
                        {
                            let mut conn = state.connection.write().await;
                            if let Some(c) = conn.get_mut(&rig.id) {
                                c.connected = true;
                                c.last_error = None;
                            }
                        }

                        let (mut write, mut read) = ws_stream.split();
                        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
                        state.command_tx.write().await.insert(rig.id.clone(), tx);

                        loop {
                            tokio::select! {
                                msg = read.next() => {
                                    match msg {
                                        Some(Ok(Message::Text(text))) => {
                                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                                                let mut conn = state.connection.write().await;
                                                if let Some(c) = conn.get_mut(&rig.id) {
                                                    c.last_snapshot = Some(json);
                                                }
                                            }
                                        }
                                        Some(Ok(Message::Close(_))) | None => break,
                                        Some(Err(_)) => break,
                                        _ => {}
                                    }
                                }
                                Some(cmd) = rx.recv() => {
                                    if write.send(Message::Text(cmd)).await.is_err() {
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let mut conn = state.connection.write().await;
                        if let Some(c) = conn.get_mut(&rig.id) {
                            c.connected = false;
                            c.last_error = Some(e.to_string());
                        }
                    }
                }

                // rig still configured? retry after a backoff, else stop the task.
                if !state.rigs.read().await.contains_key(&rig.id) {
                    break;
                }
                if let Some(c) = state.connection.write().await.get_mut(&rig.id) {
                    c.connected = false;
                }
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
        });
    }
}
