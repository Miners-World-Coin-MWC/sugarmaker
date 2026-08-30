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
    supervisor_task: JoinHandle<()>,
    stop_flag: Arc<Mutex<bool>>,
}

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
            stats.insert(
                cfg.id.clone(),
                Arc::new(Mutex::new(WorkerStats::default())),
            );

            configs.insert(cfg.id.clone(), cfg);
        }

        Arc::new(Self {
            configs: RwLock::new(configs),
            stats: RwLock::new(stats),
            running: Mutex::new(HashMap::new()),
        })
    }

    pub async fn list_configs(&self) -> Vec<WorkerConfig> {
        self.configs
            .read()
            .await
            .values()
            .cloned()
            .collect()
    }

    pub async fn upsert_config(&self, cfg: WorkerConfig) {
        self.stats
            .write()
            .await
            .entry(cfg.id.clone())
            .or_insert_with(|| {
                Arc::new(Mutex::new(WorkerStats::default()))
            });

        self.configs
            .write()
            .await
            .insert(cfg.id.clone(), cfg);
    }

    pub async fn remove_config(&self, id: &str) {
        self.stop(id).await;

        self.configs
            .write()
            .await
            .remove(id);

        self.stats
            .write()
            .await
            .remove(id);
    }

    pub async fn all_stats(&self) -> HashMap<String, WorkerStats> {
        let stats = self.stats.read().await;

        let mut out = HashMap::new();

        for (id, worker_stats) in stats.iter() {
            out.insert(
                id.clone(),
                worker_stats.lock().await.clone(),
            );
        }

        out
    }

    pub async fn start(
        self: &Arc<Self>,
        id: &str,
    ) -> anyhow::Result<()> {
        if self.running.lock().await.contains_key(id) {
            return Ok(());
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
            .or_insert_with(|| {
                Arc::new(Mutex::new(
                    WorkerStats::default(),
                ))
            })
            .clone();

        self.spawn_worker(
            id.to_string(),
            cfg,
            stats_arc,
        )
        .await
    }

    async fn spawn_worker(
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

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| {
                anyhow::anyhow!("failed to capture stdout")
            })?;

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| {
                anyhow::anyhow!("failed to capture stderr")
            })?;

        {
            let mut stats =
                stats_arc.lock().await;

            stats.running = true;
        }

        let stop_flag =
            Arc::new(Mutex::new(false));

        let stop_flag_for_task =
            stop_flag.clone();

        let stats_for_task =
            stats_arc.clone();

        let manager =
            self.clone();

        let worker_id =
            id.clone();

        let supervisor_task =
            tokio::spawn(async move {
                let mut stdout_reader =
                    BufReader::new(stdout).lines();

                let mut stderr_reader =
                    BufReader::new(stderr).lines();

                loop {
                    tokio::select! {
                        line = stdout_reader.next_line() => {
                            match line {
                                Ok(Some(line)) => {
                                    apply_line(
                                        &stats_for_task,
                                        &line,
                                    )
                                    .await;
                                }

                                Ok(None) => {
                                    break;
                                }

                                Err(err) => {
                                    eprintln!(
                                        "Worker {} stdout error: {}",
                                        worker_id,
                                        err
                                    );

                                    break;
                                }
                            }
                        }

                        line = stderr_reader.next_line() => {
                            match line {
                                Ok(Some(line)) => {
                                    apply_line(
                                        &stats_for_task,
                                        &line,
                                    )
                                    .await;
                                }

                                Ok(None) => {}

                                Err(err) => {
                                    eprintln!(
                                        "Worker {} stderr error: {}",
                                        worker_id,
                                        err
                                    );
                                }
                            }
                        }
                    }
                }

                {
                    let mut stats =
                        stats_for_task.lock().await;

                    stats.running = false;
                }

                let should_restart = {
                    let stopping =
                        *stop_flag_for_task
                            .lock()
                            .await;

                    !stopping
                };

                if !should_restart {
                    return;
                }

                {
                    let mut stats =
                        stats_for_task.lock().await;

                    stats.restarts += 1;
                }

                /*
                 * Remove the dead worker before waiting
                 * for its replacement.
                 */
                manager
                    .running
                    .lock()
                    .await
                    .remove(&worker_id);

                /*
                 * Wait before restarting.
                 */
                tokio::time::sleep(
                    std::time::Duration::from_secs(3),
                )
                .await;

                /*
                 * If the old worker was manually stopped
                 * during the delay, don't restart it.
                 */
                if *stop_flag_for_task
                    .lock()
                    .await
                {
                    return;
                }

                /*
                 * Don't create a duplicate if another
                 * worker was started during the delay.
                 */
                if manager
                    .running
                    .lock()
                    .await
                    .contains_key(&worker_id)
                {
                    return;
                }

                /*
                 * Load the latest configuration.
                 */
                let cfg = match manager
                    .configs
                    .read()
                    .await
                    .get(&worker_id)
                    .cloned()
                {
                    Some(cfg) => cfg,

                    None => {
                        eprintln!(
                            "Worker {} configuration no longer exists",
                            worker_id
                        );

                        return;
                    }
                };

                /*
                 * IMPORTANT:
                 *
                 * Restart directly.
                 *
                 * DO NOT wrap this in tokio::spawn().
                 *
                 * This eliminates the Future + Send error
                 * that was stopping the x86_64 Linux GUI build.
                 */
                if let Err(err) =
                    manager
                        .spawn_worker(
                            worker_id.clone(),
                            cfg,
                            stats_for_task.clone(),
                        )
                        .await
                {
                    eprintln!(
                        "Failed to restart worker {}: {}",
                        worker_id,
                        err
                    );
                }
            });

        self.running.lock().await.insert(
            id,
            RunningWorker {
                child,
                supervisor_task,
                stop_flag,
            },
        );

        Ok(())
    }

    pub async fn stop(&self, id: &str) {
        if let Some(worker) =
            self.running.lock().await.remove(id)
        {
            *worker.stop_flag.lock().await = true;

            let mut child =
                worker.child;

            let _ =
                child.start_kill();

            worker
                .supervisor_task
                .abort();
        }

        if let Some(stats) =
            self.stats.read().await.get(id)
        {
            let mut stats =
                stats.lock().await;

            stats.running = false;
        }
    }

    pub async fn stop_all(&self) {
        let ids: Vec<String> = self
            .running
            .lock()
            .await
            .keys()
            .cloned()
            .collect();

        for id in ids {
            self.stop(&id).await;
        }
    }
}

async fn apply_line(
    stats: &Arc<Mutex<WorkerStats>>,
    line: &str,
) {
    let event =
        parse_line(line);

    let mut stats =
        stats.lock().await;

    stats.last_line =
        line.to_string();

    match event {
        LogEvent::ThreadHashrate {
            thread,
            hashes_per_sec,
        } => {
            stats
                .per_thread_hps
                .insert(
                    thread,
                    hashes_per_sec,
                );

            stats.total_hashrate_hps =
                stats
                    .per_thread_hps
                    .values()
                    .sum();
        }

        LogEvent::Accepted {
            accepted,
            total,
            rate_hps,
        } => {
            stats.accepted =
                accepted;

            stats.total_shares =
                total;

            if stats
                .per_thread_hps
                .is_empty()
            {
                stats.total_hashrate_hps =
                    rate_hps;
            }
        }

        LogEvent::Rejected => {
            stats.rejected += 1;
        }

        LogEvent::Unrecognized => {}
    }
}
