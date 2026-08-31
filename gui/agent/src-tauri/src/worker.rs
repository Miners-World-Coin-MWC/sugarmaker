use crate::config::WorkerConfig;
use crate::parser::{parse_line, LogEvent};

use serde::{Deserialize, Serialize};

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
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

/// Owns every worker on this rig:
/// configuration, live statistics, and the actual OS process.
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

        for (id, s) in stats.iter() {
            out.insert(
                id.clone(),
                s.lock().await.clone(),
            );
        }

        out
    }

    pub async fn start(
        self: &Arc<Self>,
        id: &str,
    ) -> anyhow::Result<()> {
        /*
         * Do not start a second copy if this worker
         * is already running.
         */
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

    /*
     * Spawn one actual miner process.
     *
     * NOTE ON THE RETURN TYPE: this function is called recursively on the
     * crash-restart path below (a nested `tokio::spawn` block, still
     * lexically inside this function's body, calls `spawn_worker` again).
     * If this were a plain `async fn`, the compiler would need to embed
     * the future's own type inside itself to describe that call, which is
     * an infinite/self-referential type it can't resolve -- that's what
     * produced the "future cannot be sent between threads safely" error,
     * since it also can't prove a Send bound on a type it can't finish
     * computing.
     *
     * Returning a boxed, pinned trait object instead gives the recursive
     * call (and every other caller) a concrete, finite type to hold and
     * `.await` -- the same fix pattern as boxing a recursive struct. This
     * changes nothing at the call sites; `Pin<Box<dyn Future<...>>>` is
     * itself a `Future`, so `.await` works exactly as before.
     */
    fn spawn_worker(
        self: &Arc<Self>,
        id: String,
        cfg: WorkerConfig,
        stats_arc: Arc<Mutex<WorkerStats>>,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send + '_>> {
        Box::pin(async move {
            let mut child = Command::new(cfg.binary())
                .args(cfg.to_args())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true)
                .spawn()?;

            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| anyhow::anyhow!("failed to capture stdout"))?;

            let stderr = child
                .stderr
                .take()
                .ok_or_else(|| anyhow::anyhow!("failed to capture stderr"))?;

            /*
             * Mark worker as running.
             */
            {
                let mut stats = stats_arc.lock().await;
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

            /*
             * The supervisor task ONLY watches the miner output and,
             * on an unexpected exit, kicks off a restart via a brand new
             * top-level tokio::spawn (not by awaiting spawn_worker()
             * directly from here) -- see the note on the return type
             * above for why that indirection is what needs boxing.
             */
            let supervisor_task = tokio::spawn(async move {
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

                /*
                 * Miner output closed.
                 */
                {
                    let mut stats =
                        stats_for_task.lock().await;

                    stats.running = false;
                }

                /*
                 * Determine whether this was an intentional
                 * stop or an unexpected miner exit.
                 */
                let should_restart = {
                    let stopping =
                        *stop_flag_for_task.lock().await;

                    !stopping
                };

                if !should_restart {
                    /*
                     * Manual stop.
                     */
                    return;
                }

                /*
                 * Miner crashed/exited unexpectedly.
                 */
                {
                    let mut stats =
                        stats_for_task.lock().await;

                    stats.restarts += 1;
                }

                /*
                 * Remove the dead process from the running map.
                 */
                manager
                    .running
                    .lock()
                    .await
                    .remove(&worker_id);

                /*
                 * Delay before restarting.
                 */
                tokio::time::sleep(
                    std::time::Duration::from_secs(3),
                )
                .await;

                /*
                 * Check again after the delay in case the user
                 * stopped the worker while we were waiting.
                 */
                let stopped_during_delay = {
                    let stopping =
                        *stop_flag_for_task.lock().await;

                    stopping
                };

                if stopped_during_delay {
                    return;
                }

                /*
                 * Re-read the configuration. This means changes
                 * made through the GUI are picked up on restart.
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
                 * Start the replacement worker.
                 *
                 * We intentionally do not await spawn_worker()
                 * from the current supervisor task.
                 *
                 * Instead, this supervisor task finishes and a
                 * completely independent Tokio task performs the
                 * restart -- calling the boxed spawn_worker() above,
                 * which is now a well-formed, finite type to await.
                 */
                let manager_for_restart =
                    manager.clone();

                let stats_for_restart =
                    stats_for_task.clone();

                let id_for_restart =
                    worker_id.clone();

                tokio::spawn(async move {
                    if let Err(err) =
                        manager_for_restart
                            .spawn_worker(
                                id_for_restart.clone(),
                                cfg,
                                stats_for_restart,
                            )
                            .await
                    {
                        eprintln!(
                            "Failed to restart worker {}: {}",
                            id_for_restart,
                            err
                        );
                    }
                });
            });

            /*
             * Register the process.
             */
            self.running.lock().await.insert(
                id,
                RunningWorker {
                    child,
                    supervisor_task,
                    stop_flag,
                },
            );

            Ok(())
        })
    }

    pub async fn stop(&self, id: &str) {
        if let Some(mut worker) =
            self.running.lock().await.remove(id)
        {
            /*
             * Tell the supervisor that this is an
             * intentional shutdown.
             */
            *worker.stop_flag.lock().await = true;

            /*
             * Terminate the miner process.
             */
            let _ = worker.child.start_kill();

            /*
             * Stop the supervisor task.
             */
            worker.supervisor_task.abort();
        }

        /*
         * Update the visible worker state.
         */
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
    let event = parse_line(line);

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

            /*
             * If thread-level hashrate hasn't been seen,
             * use the aggregate rate from the miner.
             */
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
