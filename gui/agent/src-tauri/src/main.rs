#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod parser;
mod sysinfo_util;
mod worker;
mod ws_server;

use config::{load_workers, save_workers, WorkerConfig};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
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

/// Result returned by the CPU benchmark.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct BenchmarkResult {
    schema_version: u32,
    benchmark: BenchmarkData,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct BenchmarkData {
    algorithm: String,
    cpu: String,
    architecture: String,
    os: String,
    threads: u32,
    hashrate_hps: f64,
    per_thread_hps: f64,
    duration_seconds: u64,
    sugarmaker_version: String,
    timestamp: String,
}

/// List all configured mining workers.
#[tauri::command]
async fn list_workers(
    state: State<'_, AppState>,
) -> Result<Vec<WorkerConfig>, String> {
    Ok(state.manager.list_configs().await)
}

/// Get current statistics for all workers.
#[tauri::command]
async fn get_stats(
    state: State<'_, AppState>,
) -> Result<HashMap<String, WorkerStats>, String> {
    Ok(state.manager.all_stats().await)
}

/// Get current system / rig information.
#[tauri::command]
async fn get_rig_info() -> Result<RigInfo, String> {
    Ok(sysinfo_util::snapshot())
}

/// Get the address used by the dashboard WebSocket server.
#[tauri::command]
async fn get_dashboard_connection() -> Result<DashboardConnection, String> {
    let ip = detect_local_ip();

    Ok(DashboardConnection {
        websocket_url: format!("ws://{}:{}", ip, DASHBOARD_PORT),
        ip,
        port: DASHBOARD_PORT,
    })
}

/// Add or update a mining worker.
#[tauri::command]
async fn upsert_worker(
    state: State<'_, AppState>,
    config: WorkerConfig,
) -> Result<(), String> {
    state.manager.upsert_config(config).await;

    save_workers(&state.manager.list_configs().await)
        .map_err(|e| e.to_string())
}

/// Remove a mining worker.
#[tauri::command]
async fn remove_worker(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.manager.remove_config(&id).await;

    save_workers(&state.manager.list_configs().await)
        .map_err(|e| e.to_string())
}

/// Start a mining worker.
#[tauri::command]
async fn start_worker(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.manager.start(&id).await.map_err(|e| e.to_string())
}

/// Stop a mining worker.
#[tauri::command]
async fn stop_worker(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.manager.stop(&id).await;
    Ok(())
}

/// Return the bundled benchmark executable name for this platform.
#[cfg(target_os = "windows")]
fn benchmark_binary_name() -> &'static str {
    "sugarmaker-benchmark.exe"
}

#[cfg(not(target_os = "windows"))]
fn benchmark_binary_name() -> &'static str {
    "sugarmaker-benchmark"
}

/// Locate the benchmark executable.
///
/// The production Agent bundles the executable into:
///
///     resources/binaries/sugarmaker-benchmark
///
/// or on Windows:
///
///     resources/binaries/sugarmaker-benchmark.exe
///
/// In development mode we also fall back to the executable being available
/// on PATH.
fn benchmark_binary_path(app: &tauri::AppHandle) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| {
            format!(
                "Failed to locate application resources: {}",
                e
            )
        })?;

    let bundled = resource_dir
        .join("binaries")
        .join(benchmark_binary_name());

    if bundled.exists() {
        return Ok(bundled.to_string_lossy().to_string());
    }

    // Development fallback.
    Ok(benchmark_binary_name().to_string())
}

/// Return the path used for the latest local benchmark result.
fn benchmark_result_path(
    app: &tauri::AppHandle,
) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| {
            format!(
                "Failed to locate application data directory: {}",
                e
            )
        })?;

    Ok(app_data_dir.join("benchmark-result.json"))
}

/// Save the latest benchmark result locally.
///
/// The Agent keeps this file separate from the community benchmark data.
/// It represents only the user's own latest benchmark result.
///
/// Each successful benchmark replaces the previous file.
fn save_benchmark_result(
    app: &tauri::AppHandle,
    result: &BenchmarkResult,
) -> Result<PathBuf, String> {
    let result_path = benchmark_result_path(app)?;

    if let Some(parent) = result_path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create benchmark result directory '{}': {}",
                parent.display(),
                e
            )
        })?;
    }

    let json = serde_json::to_string_pretty(result)
        .map_err(|e| {
            format!(
                "Failed to serialize benchmark result: {}",
                e
            )
        })?;

    fs::write(
        &result_path,
        format!("{}\n", json),
    )
    .map_err(|e| {
        format!(
            "Failed to save benchmark result '{}': {}",
            result_path.display(),
            e
        )
    })?;

    Ok(result_path)
}

/// Load the latest locally saved benchmark result.
///
/// Returns:
///
///     Some(result)
///
/// when benchmark-result.json exists and contains a valid benchmark result.
///
/// Returns:
///
///     None
///
/// when the user has not run a benchmark yet.
#[tauri::command]
async fn get_saved_benchmark_result(
    app: tauri::AppHandle,
) -> Result<Option<BenchmarkResult>, String> {
    let result_path = benchmark_result_path(&app)?;

    if !result_path.exists() {
        return Ok(None);
    }

    let json = fs::read_to_string(&result_path)
        .map_err(|e| {
            format!(
                "Failed to read local benchmark result '{}': {}",
                result_path.display(),
                e
            )
        })?;

    let result: BenchmarkResult =
        serde_json::from_str(&json)
            .map_err(|e| {
                format!(
                    "Failed to parse local benchmark result '{}': {}",
                    result_path.display(),
                    e
                )
            })?;

    Ok(Some(result))
}

/// Open the latest local benchmark-result.json using the operating
/// system's default application.
///
/// Windows:
///     cmd /C start "" <file>
///
/// macOS:
///     open <file>
///
/// Linux / other Unix:
///     xdg-open <file>
#[tauri::command]
async fn open_benchmark_result(
    app: tauri::AppHandle,
) -> Result<(), String> {
    let result_path = benchmark_result_path(&app)?;

    if !result_path.exists() {
        return Err(
            "No local benchmark result exists yet. Run a benchmark first."
                .to_string(),
        );
    }

    let path = result_path
        .to_string_lossy()
        .to_string();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args([
                "/C",
                "start",
                "",
                &path,
            ])
            .spawn()
            .map_err(|e| {
                format!(
                    "Failed to open benchmark-result.json: {}",
                    e
                )
            })?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| {
                format!(
                    "Failed to open benchmark-result.json: {}",
                    e
                )
            })?;
    }

    #[cfg(all(
        unix,
        not(target_os = "macos")
    ))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| {
                format!(
                    "Failed to open benchmark-result.json: {}",
                    e
                )
            })?;
    }

    Ok(())
}

/// Run the standalone Sugarmaker CPU benchmark.
///
/// Example:
///
/// sugarmaker-benchmark --algo YespowerMwc --threads 4 --duration 30
///
/// The benchmark executable remains the source of truth for the actual
/// Yespower implementation. The Agent simply launches it and parses its
/// machine-readable BENCHMARK_RESULT line.
///
/// After a successful benchmark the Agent automatically saves:
///
///     benchmark-result.json
///
/// inside the application's user-writable application data directory.
#[tauri::command]
async fn run_benchmark(
    app: tauri::AppHandle,
    algorithm: String,
    threads: u32,
    duration: u64,
) -> Result<BenchmarkResult, String> {
    let algorithm = algorithm.trim().to_string();

    if algorithm != "YespowerMwc"
        && algorithm != "YespowerAdvc"
    {
        return Err(
            "Unsupported benchmark algorithm. Use YespowerMwc or YespowerAdvc."
                .to_string(),
        );
    }

    if threads == 0 {
        return Err(
            "Benchmark thread count must be at least 1."
                .to_string(),
        );
    }

    if duration == 0 {
        return Err(
            "Benchmark duration must be at least 1 second."
                .to_string(),
        );
    }

    let binary = benchmark_binary_path(&app)?;

    let output = tokio::process::Command::new(&binary)
        .arg("--algo")
        .arg(&algorithm)
        .arg("--threads")
        .arg(threads.to_string())
        .arg("--duration")
        .arg(duration.to_string())
        .output()
        .await
        .map_err(|e| {
            format!(
                "Failed to start sugarmaker-benchmark '{}': {}",
                binary,
                e
            )
        })?;

    let stdout = String::from_utf8_lossy(
        &output.stdout
    );

    let stderr = String::from_utf8_lossy(
        &output.stderr
    );

    if !output.status.success() {
        let details = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };

        if details.is_empty() {
            return Err(format!(
                "sugarmaker-benchmark exited with status {}.",
                output.status
            ));
        }

        return Err(format!(
            "sugarmaker-benchmark failed: {}",
            details
        ));
    }

    let result_line = stdout
        .lines()
        .find(|line| {
            line.trim_start()
                .starts_with("BENCHMARK_RESULT ")
        });

    let result_line = match result_line {
        Some(line) => line.trim(),
        None => {
            return Err(
                "Benchmark completed but no BENCHMARK_RESULT line was returned."
                    .to_string(),
            );
        }
    };

    let fields =
        parse_benchmark_result_line(result_line)?;

    let result_algorithm = fields
        .get("algo")
        .cloned()
        .unwrap_or_else(|| algorithm.clone());

    let result_threads = parse_u32_field(
        &fields,
        "threads",
        "benchmark result",
    )?;

    let hashrate_hps = parse_f64_field(
        &fields,
        "hashrate_hps",
        "benchmark result",
    )?;

    let per_thread_hps = parse_f64_field(
        &fields,
        "per_thread_hps",
        "benchmark result",
    )?;

    let result_duration = parse_u64_field(
        &fields,
        "duration_seconds",
        "benchmark result",
    )?;

    let rig =
        sysinfo_util::snapshot();

    let timestamp =
        chrono::Utc::now()
            .to_rfc3339_opts(
                chrono::SecondsFormat::Secs,
                true,
            );

    let result = BenchmarkResult {
        schema_version: 1,
        benchmark: BenchmarkData {
            algorithm: result_algorithm,
            cpu: rig.cpu_brand,
            architecture: rig.arch,
            os: rig.os,
            threads: result_threads,
            hashrate_hps,
            per_thread_hps,
            duration_seconds: result_duration,
            sugarmaker_version: "1.0.0".to_string(),
            timestamp,
        },
    };

    /*
     * Save the validated benchmark result locally.
     *
     * If this fails, report the error to the GUI rather than pretending
     * the local result was saved.
     */
    save_benchmark_result(
        &app,
        &result,
    )?;

    Ok(result)
}

/// Parse the machine-readable benchmark line:
///
/// BENCHMARK_RESULT algo=YespowerMwc threads=4
/// hashrate_hps=123.45 per_thread_hps=30.86 duration_seconds=30
fn parse_benchmark_result_line(
    line: &str,
) -> Result<HashMap<String, String>, String> {
    let prefix =
        "BENCHMARK_RESULT ";

    if !line.starts_with(prefix) {
        return Err(
            "Invalid benchmark result line returned by benchmark executable."
                .to_string(),
        );
    }

    let mut fields =
        HashMap::new();

    for token in line[prefix.len()..]
        .split_whitespace()
    {
        let (key, value) =
            token.split_once('=')
                .ok_or_else(|| {
                    format!(
                        "Invalid benchmark result field '{}'.",
                        token
                    )
                })?;

        if key.is_empty()
            || value.is_empty()
        {
            return Err(format!(
                "Invalid benchmark result field '{}'.",
                token
            ));
        }

        fields.insert(
            key.to_string(),
            value.to_string(),
        );
    }

    Ok(fields)
}

fn parse_u32_field(
    fields: &HashMap<String, String>,
    name: &str,
    context: &str,
) -> Result<u32, String> {
    let value =
        fields.get(name)
            .ok_or_else(|| {
                format!(
                    "Missing '{}' in {}.",
                    name,
                    context
                )
            })?;

    value
        .parse::<u32>()
        .map_err(|_| {
            format!(
                "Invalid '{}' value '{}' in {}.",
                name,
                value,
                context
            )
        })
}

fn parse_u64_field(
    fields: &HashMap<String, String>,
    name: &str,
    context: &str,
) -> Result<u64, String> {
    let value =
        fields.get(name)
            .ok_or_else(|| {
                format!(
                    "Missing '{}' in {}.",
                    name,
                    context
                )
            })?;

    value
        .parse::<u64>()
        .map_err(|_| {
            format!(
                "Invalid '{}' value '{}' in {}.",
                name,
                value,
                context
            )
        })
}

fn parse_f64_field(
    fields: &HashMap<String, String>,
    name: &str,
    context: &str,
) -> Result<f64, String> {
    let value =
        fields.get(name)
            .ok_or_else(|| {
                format!(
                    "Missing '{}' in {}.",
                    name,
                    context
                )
            })?;

    let parsed =
        value.parse::<f64>()
            .map_err(|_| {
                format!(
                    "Invalid '{}' value '{}' in {}.",
                    name,
                    value,
                    context
                )
            })?;

    if !parsed.is_finite()
        || parsed < 0.0
    {
        return Err(format!(
            "Invalid '{}' value '{}' in {}.",
            name,
            value,
            context
        ));
    }

    Ok(parsed)
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
    let initial_workers =
        load_workers();

    let manager =
        WorkerManager::new(
            initial_workers.clone()
        );

    let manager_for_setup =
        manager.clone();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_shell::init()
        )
        .manage(AppState {
            manager,
        })
        .setup(move |app| {
            // Resource dir is only known once the app is built, hence doing
            // this here rather than before tauri::Builder::default().
            if let Ok(resource_dir) =
                app.path().resource_dir()
            {
                config::set_resource_dir(
                    resource_dir
                );
            }

            let manager_for_bg =
                manager_for_setup.clone();

            let workers =
                initial_workers.clone();

            tauri::async_runtime::spawn(
                async move {
                    // Start workers configured for autostart.
                    for cfg in workers {
                        if cfg.autostart {
                            let _ =
                                manager_for_bg
                                    .start(&cfg.id)
                                    .await;
                        }
                    }

                    // Start the dashboard WebSocket server.
                    let _ =
                        ws_server::run(
                            manager_for_bg,
                            DASHBOARD_PORT,
                        )
                        .await;
                },
            );

            Ok(())
        })
        .invoke_handler(
            tauri::generate_handler![
                list_workers,
                get_stats,
                get_rig_info,
                get_dashboard_connection,
                upsert_worker,
                remove_worker,
                start_worker,
                stop_worker,
                run_benchmark,
                get_saved_benchmark_result,
                open_benchmark_result,
            ],
        )
        .run(
            tauri::generate_context!()
        )
        .expect(
            "error while running sugarmaker-agent"
        );
}
