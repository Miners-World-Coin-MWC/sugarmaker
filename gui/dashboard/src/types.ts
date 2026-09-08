export interface RigEntry {
  id: string;
  label: string;
  address: string; // "host:port", e.g. "192.168.1.42:4780"
}

export interface WorkerConfig {
  id: string;
  label: string;
  pool_url: string;
  username: string;
  threads: number;
}

export interface WorkerStats {
  running: boolean;
  total_hashrate_hps: number;
  per_thread_hps: Record<string, number>;
  accepted: number;
  rejected: number;
  total_shares: number;
  last_line: string;
  restarts: number;
}

export interface RigInfo {
  hostname: string;
  cpu_brand: string;
  physical_cores: number;
  logical_cores: number;
  cpu_usage_percent: number;
  os: string;
  arch: string;
}

// This is the raw snapshot broadcast by the rig agent's ws_server (see
// agent/src-tauri/src/ws_server.rs RigSnapshot struct) -- kept in sync manually.
export interface RigSnapshot {
  rig: RigInfo;
  workers: WorkerConfig[];
  stats: Record<string, WorkerStats>;
}

export interface RigConnectionState {
  connected: boolean;
  last_error: string | null;
  last_snapshot: RigSnapshot | null;
}

export function formatHashrate(hps: number): string {
  if (hps >= 1_000_000) return (hps / 1_000_000).toFixed(2) + " MH/s";
  if (hps >= 1_000) return (hps / 1_000).toFixed(2) + " kH/s";
  return hps.toFixed(1) + " H/s";
}
