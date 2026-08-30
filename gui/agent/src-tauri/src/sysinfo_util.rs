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
    sys.refresh_all();
    // A second refresh with a short gap gives a meaningful global CPU % reading.
    std::thread::sleep(std::time::Duration::from_millis(200));
    sys.refresh_cpu_usage();

    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    RigInfo {
        hostname: System::host_name().unwrap_or_else(|| "unknown-rig".to_string()),
        cpu_brand,
        physical_cores: System::physical_core_count().unwrap_or(0),
        logical_cores: sys.cpus().len(),
        cpu_usage_percent: sys.global_cpu_usage(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}
