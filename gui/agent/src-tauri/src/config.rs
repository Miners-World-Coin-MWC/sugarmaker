use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

/// Set once from main.rs's setup() hook once Tauri's resource dir is known.
/// Lets `WorkerConfig::binary()` find the sugarmaker executable that CI bundled
/// alongside the app, without every call site needing an AppHandle.
static RESOURCE_DIR: OnceCell<PathBuf> = OnceCell::new();

pub fn set_resource_dir(dir: PathBuf) {
    let _ = RESOURCE_DIR.set(dir);
}

/// Default algorithm used by the MWC GUI.
fn default_algorithm() -> String {
    "YespowerMwc".to_string()
}

/// One worker = one `sugarmaker` process with its own CLI args.
/// Maps directly onto sugarmaker's own flags so we don't reinvent anything.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerConfig {
    pub id: String,
    pub label: String,

    /// Mining algorithm.
    /// Defaults to YespowerMwc for existing worker configurations that do not
    /// yet contain an `algo` field.
    #[serde(default = "default_algorithm")]
    pub algo: String,

    /// e.g. "stratum+tcp://bmine.net:3033" or a local solo RPC URL
    pub pool_url: String,

    pub username: String,
    pub password: String,

    /// only used for solo mining
    pub coinbase_addr: Option<String>,

    pub threads: u32,

    /// path to the sugarmaker binary for this platform; defaults to "sugarmaker" on PATH
    pub binary_path: Option<String>,

    /// any extra raw CLI flags the user wants appended verbatim
    pub extra_args: Vec<String>,

    pub autostart: bool,
}

impl WorkerConfig {
    pub fn new_default(label: &str) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            label: label.to_string(),
            algo: default_algorithm(),
            pool_url: "stratum+tcp://bmine.net:3033".to_string(),
            username: String::new(),
            password: "x".to_string(),
            coinbase_addr: None,
            threads: 1,
            binary_path: None,
            extra_args: vec![],
            autostart: false,
        }
    }

    /// Builds the argv (without the binary itself) to pass to Command::args.
    ///
    /// Produces:
    ///
    /// sugarmaker --a YespowerMwc --url <pool> --threads <threads>
    ///            --user <wallet.worker> --pass <password>
    pub fn to_args(&self) -> Vec<String> {
        let algorithm = if self.algo.trim().is_empty() {
            default_algorithm()
        } else {
            self.algo.trim().to_string()
        };

        let mut args = vec![
            "--a".to_string(),
            algorithm,

            "--url".to_string(),
            self.pool_url.clone(),

            "--threads".to_string(),
            self.threads.to_string(),

            "--user".to_string(),
            self.username.clone(),

            "--pass".to_string(),
            self.password.clone(),
        ];

        if let Some(addr) = &self.coinbase_addr {
            if !addr.is_empty() {
                args.push(format!("--coinbase-addr={}", addr));
            }
        }

        args.extend(self.extra_args.clone());

        args
    }

    /// Resolution order:
    /// 1. an explicit path the user set in the config editor
    /// 2. the sugarmaker binary bundled into this app's resources by CI
    ///    (gui/agent/src-tauri/binaries/sugarmaker, copied there at build time
    ///    from the same repo's `make` output for that platform)
    /// 3. bare binary name, relying on PATH (dev-mode fallback)
    pub fn binary(&self) -> String {
        if let Some(p) = &self.binary_path {
            if !p.is_empty() {
                return p.clone();
            }
        }

        if let Some(dir) = RESOURCE_DIR.get() {
            let bundled = dir.join("binaries").join(default_binary_name());

            if bundled.exists() {
                return bundled.to_string_lossy().to_string();
            }
        }

        default_binary_name()
    }
}

#[cfg(target_os = "windows")]
fn default_binary_name() -> String {
    "sugarmaker.exe".to_string()
}

#[cfg(not(target_os = "windows"))]
fn default_binary_name() -> String {
    "sugarmaker".to_string()
}

fn config_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("sugarmaker-gui");

    let _ = fs::create_dir_all(&dir);

    dir
}

fn config_path() -> PathBuf {
    config_dir().join("workers.json")
}

pub fn load_workers() -> Vec<WorkerConfig> {
    let path = config_path();

    if let Ok(bytes) = fs::read(&path) {
        if let Ok(list) = serde_json::from_slice::<Vec<WorkerConfig>>(&bytes) {
            return list;
        }
    }

    vec![]
}

pub fn save_workers(workers: &[WorkerConfig]) -> anyhow::Result<()> {
    let path = config_path();
    let bytes = serde_json::to_vec_pretty(workers)?;

    fs::write(path, bytes)?;

    Ok(())
}
