use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;

use crate::sysinfo_util;

/// Location of the local community benchmark file.
///
/// This deliberately lives in the application's data directory rather
/// than inside the installed application resources, because the GUI needs
/// to be able to add benchmark results without requiring administrator
/// privileges or modifying the installed application.
fn benchmark_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("sugarmaker-gui");

    let _ = fs::create_dir_all(&dir);

    dir
}

fn benchmark_path() -> PathBuf {
    benchmark_dir().join("benchmark.json")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkFile {
    pub schema_version: u32,
    pub benchmarks: Vec<BenchmarkEntry>,
}

impl Default for BenchmarkFile {
    fn default() -> Self {
        Self {
            schema_version: 1,
            benchmarks: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkEntry {
    pub algorithm: String,
    pub cpu: String,
    pub architecture: String,
    pub os: String,
    pub threads: u32,
    pub hashrate_hps: f64,
    pub per_thread_hps: f64,
    pub duration_seconds: u64,
    pub sugarmaker_version: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Deserialize)]
struct BenchmarkProcessResult {
    algorithm: String,
    threads: u32,
    hashrate_hps: f64,
    duration_seconds: u64,
}

/// Load benchmark.json.
///
/// If the local file doesn't exist yet, return an empty dataset.
pub fn load_benchmarks() -> anyhow::Result<BenchmarkFile> {
    let path = benchmark_path();

    if !path.exists() {
        return Ok(BenchmarkFile::default());
    }

    let bytes = fs::read(path)?;

    let file = serde_json::from_slice::<BenchmarkFile>(&bytes)?;

    Ok(file)
}

/// Save benchmark.json.
fn save_benchmarks(file: &BenchmarkFile) -> anyhow::Result<()> {
    let path = benchmark_path();

    let bytes = serde_json::to_vec_pretty(file)?;

    fs::write(path, bytes)?;

    Ok(())
}

/// Resolve the benchmark executable.
///
/// CI will bundle this alongside sugarmaker:
///
/// binaries/
/// ├── sugarmaker
/// └── sugarmaker-benchmark
///
/// The resource directory is discovered by main.rs and passed through
/// the same mechanism used by WorkerConfig.
fn benchmark_binary() -> String {
    #[cfg(target_os = "windows")]
    const NAME: &str = "sugarmaker-benchmark.exe";

    #[cfg(not(target_os = "windows"))]
    const NAME: &str = "sugarmaker-benchmark";

    if let Some(resource_dir) =
        crate::config::resource_dir()
    {
        let bundled = resource_dir.join("binaries").join(NAME);

        if bundled.exists() {
            return bundled.to_string_lossy().to_string();
        }
    }

    NAME.to_string()
}

/// Run a benchmark executable and return its machine-readable result.
pub async fn run_benchmark_process(
    algorithm: String,
    threads: u32,
    duration_seconds: u64,
) -> anyhow::Result<BenchmarkProcessResult> {
    if threads == 0 {
        return Err(anyhow::anyhow!(
            "Benchmark thread count must be at least 1"
        ));
    }

    if duration_seconds == 0 {
        return Err(anyhow::anyhow!(
            "Benchmark duration must be greater than 0"
        ));
    }

    let binary = benchmark_binary();

    let output = Command::new(&binary)
        .args([
            "--algo",
            algorithm.as_str(),
            "--threads",
            &threads.to_string(),
            "--duration",
            &duration_seconds.to_string(),
            "--machine",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    if !output.status.success() {
        let stderr =
            String::from_utf8_lossy(&output.stderr);

        return Err(anyhow::anyhow!(
            "Benchmark process failed: {}",
            stderr.trim()
        ));
    }

    let stdout =
        String::from_utf8_lossy(&output.stdout);

    let result_line = stdout
        .lines()
        .find(|line| line.starts_with("BENCHMARK_RESULT "))
        .ok_or_else(|| {
            anyhow::anyhow!(
                "Benchmark did not return a valid result"
            )
        })?;

    parse_machine_result(result_line)
}

fn parse_machine_result(
    line: &str,
) -> anyhow::Result<BenchmarkProcessResult> {
    let payload = line
        .strip_prefix("BENCHMARK_RESULT ")
        .ok_or_else(|| {
            anyhow::anyhow!(
                "Invalid benchmark result prefix"
            )
        })?;

    let mut algorithm = None;
    let mut threads = None;
    let mut hashrate_hps = None;
    let mut duration_seconds = None;

    for field in payload.split_whitespace() {
        let Some((key, value)) = field.split_once('=') else {
            continue;
        };

        match key {
            "algo" => {
                algorithm = Some(value.to_string());
            }

            "threads" => {
                threads = Some(value.parse::<u32>()?);
            }

            "hashrate_hps" => {
                hashrate_hps = Some(value.parse::<f64>()?);
            }

            "duration_seconds" => {
                duration_seconds =
                    Some(value.parse::<u64>()?);
            }

            _ => {}
        }
    }

    Ok(BenchmarkProcessResult {
        algorithm: algorithm.ok_or_else(|| {
            anyhow::anyhow!(
                "Benchmark result is missing algorithm"
            )
        })?,

        threads: threads.ok_or_else(|| {
            anyhow::anyhow!(
                "Benchmark result is missing thread count"
            )
        })?,

        hashrate_hps: hashrate_hps.ok_or_else(|| {
            anyhow::anyhow!(
                "Benchmark result is missing hashrate"
            )
        })?,

        duration_seconds: duration_seconds.ok_or_else(|| {
            anyhow::anyhow!(
                "Benchmark result is missing duration"
            )
        })?,
    })
}

/// Execute a benchmark and append the result to benchmark.json.
pub async fn run_benchmark(
    algorithm: String,
    threads: u32,
    duration_seconds: u64,
) -> anyhow::Result<BenchmarkEntry> {
    let result = run_benchmark_process(
        algorithm,
        threads,
        duration_seconds,
    )
    .await?;

    let rig = sysinfo_util::snapshot();

    let per_thread_hps =
        if result.threads > 0 {
            result.hashrate_hps / result.threads as f64
        } else {
            0.0
        };

    let entry = BenchmarkEntry {
        algorithm: result.algorithm,
        cpu: rig.cpu_brand,
        architecture: rig.arch,
        os: rig.os,
        threads: result.threads,
        hashrate_hps: result.hashrate_hps,
        per_thread_hps,
        duration_seconds: result.duration_seconds,

        // Keep this independent from the agent version for now.
        // The benchmark executable can provide its own version later.
        sugarmaker_version: "1.0.0".to_string(),

        timestamp: Utc::now().to_rfc3339(),
    };

    let mut file = load_benchmarks()?;

    file.schema_version = 1;
    file.benchmarks.push(entry.clone());

    save_benchmarks(&file)?;

    Ok(entry)
}
