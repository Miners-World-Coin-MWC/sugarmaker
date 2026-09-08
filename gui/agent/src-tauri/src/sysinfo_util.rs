use serde::{Deserialize, Serialize};
use sysinfo::System;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RigInfo {
    pub hostname: String,
    pub cpu_brand: String,
    pub physical_cores: usize,
    pub logical_cores: usize,
    pub cpu_usage_percent: f32,
    pub os: String,
    pub arch: String,
}

pub fn snapshot() -> RigInfo {
    let mut sys = System::new_all();
    // Initial refresh.
    sys.refresh_all();
    // A second CPU refresh after a short delay gives sysinfo enough
    // information to calculate a meaningful CPU usage percentage.
    std::thread::sleep(std::time::Duration::from_millis(200));
    sys.refresh_cpu_usage();
    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let physical_cores = sys.physical_core_count().unwrap_or(0);
    let logical_cores = sys.cpus().len();

    RigInfo {
        hostname: System::host_name()
            .unwrap_or_else(|| "unknown-rig".to_string()),
        cpu_brand,
        physical_cores,
        logical_cores,
        cpu_usage_percent: sys.global_cpu_usage(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}
