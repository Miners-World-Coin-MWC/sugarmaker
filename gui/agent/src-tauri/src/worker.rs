use crate::config::WorkerConfig;
use crate::parser::{parse_line, LogEvent};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkerStats {
    pub running: bool,
    pub total_hashrate_hps: f64,
    pub per_thread_hps: HashMap<u32, f64>,
    pub accepted: u64,
    pub rejected: u64,
    pub total_shares: u64,
    pub last_line: String,
    pub restarts: u32,
}

struct RunningWorker {
    child: Child,
    stdout_task: JoinHandle<()>,
    supervisor_stop: Arc<Mutex<bool>>,
}

/// Owns every worker on this rig: config, live stats, and the actual OS process.
pub struct WorkerManager {
    configs: RwLock<HashMap<String, WorkerConfig>>,
    stats: RwLock<HashMap<String, Arc<Mutex<WorkerStats>>>>,
    running: Mutex<HashMap<String, RunningWorker>>,
}

impl WorkerManager {
    pub fn new(initial: Vec<WorkerConfig>) -> Arc<Self> {
        let mut configs = HashMap::new();
        let mut stats = HashMap::new();
        for cfg in initial {
            stats.insert(cfg.id.clone(), Arc::new(Mutex::new(WorkerStats::default())));
            configs.insert(cfg.id.clone(), cfg);
        }
        Arc::new(Self {
            configs: RwLock::new(configs),
            stats: RwLock::new(stats),
            running: Mutex::new(HashMap::new()),
        })
    }

    pub async fn list_configs(&self) -> Vec<WorkerConfig> {
        self.configs.read().await.values().cloned().collect()
    }

    pub async fn upsert_config(&self, cfg: WorkerConfig) {
        self.stats
            .write()
            .await
            .entry(cfg.id.clone())
            .or_insert_with(|| Arc::new(Mutex::new(WorkerStats::default())));
        self.configs.write().await.insert(cfg.id.clone(), cfg);
    }

    pub async fn remove_config(&self, id: &str) {
        self.stop(id).await;
        self.configs.write().await.remove(id);
        self.stats.write().await.remove(id);
    }

    pub async fn all_stats(&self) -> HashMap<String, WorkerStats> {
        let stats = self.stats.read().await;
        let mut out = HashMap::new();
        for (id, s) in stats.iter() {
            out.insert(id.clone(), s.lock().await.clone());
        }
        out
    }

    pub async fn start(self: &Arc<Self>, id: &str) -> anyhow::Result<()> {
        if self.running.lock().await.contains_key(id) {
            return Ok(()); // already running
        }
        let cfg = self
            .configs
            .read()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("unknown worker id"))?;

        let stats_arc = self
            .stats
            .write()
            .await
            .entry(id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(WorkerStats::default())))
            .clone();

        self.spawn_and_watch(id.to_string(), cfg, stats_arc).await
    }

    async fn spawn_and_watch(
        self: &Arc<Self>,
        id: String,
        cfg: WorkerConfig,
        stats_arc: Arc<Mutex<WorkerStats>>,
    ) -> anyhow::Result<()> {
        let mut child = Command::new(cfg.binary())
            .args(cfg.to_args())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;

        let stdout = child.stdout.take().expect("stdout piped");
        let stderr = child.stderr.take().expect("stderr piped");

        {
            let mut s = stats_arc.lock().await;
            s.running = true;
        }

        let supervisor_stop = Arc::new(Mutex::new(false));
        let stop_flag = supervisor_stop.clone();
        let stats_for_task = stats_arc.clone();
        let manager = self.clone();
        let id_for_task = id.clone();
        let cfg_for_task = cfg.clone();

        let stdout_task = tokio::spawn(async move {
            let mut out_reader = BufReader::new(stdout).lines();
            let mut err_reader = BufReader::new(stderr).lines();

            loop {
                tokio::select! {
                    line = out_reader.next_line() => {
                        match line {
                            Ok(Some(l)) => apply_line(&stats_for_task, &l).await,
                            Ok(None) => break,
                            Err(_) => break,
                        }
                    }
                    line = err_reader.next_line() => {
                        match line {
                            Ok(Some(l)) => apply_line(&stats_for_task, &l).await,
                            Ok(None) => {},
                            Err(_) => {},
                        }
                    }
                }
            }

            // process stdout closed -> process exited
            {
                let mut s = stats_for_task.lock().await;
                s.running = false;
            }

            let should_restart = {
                let stopping = *stop_flag.lock().await;
                !stopping
            };

            if should_restart {
                {
                    let mut s = stats_for_task.lock().await;
                    s.restarts += 1;
                }
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                manager.running.lock().await.remove(&id_for_task);
                let _ = manager
                    .spawn_and_watch(id_for_task.clone(), cfg_for_task.clone(), stats_for_task.clone())
                    .await;
            }
        });

        self.running.lock().await.insert(
            id,
            RunningWorker {
                child,
                stdout_task,
                supervisor_stop,
            },
        );

        Ok(())
    }

    pub async fn stop(&self, id: &str) {
        if let Some(mut rw) = self.running.lock().await.remove(id) {
            *rw.supervisor_stop.lock().await = true;
            let _ = rw.child.start_kill();
            rw.stdout_task.abort();
        }
        if let Some(s) = self.stats.read().await.get(id) {
            let mut s = s.lock().await;
            s.running = false;
        }
    }

    pub async fn stop_all(&self) {
        let ids: Vec<String> = self.running.lock().await.keys().cloned().collect();
        for id in ids {
            self.stop(&id).await;
        }
    }
}

async fn apply_line(stats: &Arc<Mutex<WorkerStats>>, line: &str) {
    let event = parse_line(line);
    let mut s = stats.lock().await;
    s.last_line = line.to_string();
    match event {
        LogEvent::ThreadHashrate { thread, hashes_per_sec } => {
            s.per_thread_hps.insert(thread, hashes_per_sec);
            s.total_hashrate_hps = s.per_thread_hps.values().sum();
        }
        LogEvent::Accepted { accepted, total, rate_hps } => {
            s.accepted = accepted;
            s.total_shares = total;
            if s.per_thread_hps.is_empty() {
                s.total_hashrate_hps = rate_hps;
            }
        }
        LogEvent::Rejected => {
            s.rejected += 1;
        }
        LogEvent::Unrecognized => {}
    }
}
