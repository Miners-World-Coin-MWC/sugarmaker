export interface WorkerConfig {
  id: string;
  label: string;
  algo: string;
  pool_url: string;
  username: string;
  password: string;
  coinbase_addr: string | null;
  threads: number;
  binary_path: string | null;
  extra_args: string[];
  autostart: boolean;
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

/*
 * CPU benchmark result returned by the Tauri backend.
 *
 * This mirrors the JSON schema produced by
 * sugarmaker-benchmark while also including the
 * system information that the GUI already knows.
 */
export interface BenchmarkResult {
  schema_version: number;

  benchmark: {
    algorithm: string;
    cpu: string;
    architecture: string;
    os: string;
    threads: number;
    hashrate_hps: number;
    per_thread_hps: number;
    duration_seconds: number;
    sugarmaker_version: string;
    timestamp: string;
  };
}

/*
 * Benchmark configuration used by the Agent UI.
 */
export interface BenchmarkConfig {
  algorithm: "YespowerMwc" | "YespowerAdvc";
  threads: number;
  duration: number;
}

export function emptyWorker(label: string): WorkerConfig {
  return {
    id: crypto.randomUUID(),
    label,
    algo: "YespowerMwc",
    pool_url: "stratum+tcp://bmine.net:3033",
    username: "",
    password: "x",
    coinbase_addr: null,
    threads: 1,
    binary_path: null,
    extra_args: [],
    autostart: false,
  };
}

export function formatHashrate(hps: number): string {
  if (hps >= 1_000_000_000) {
    return (hps / 1_000_000_000).toFixed(2) + " GH/s";
  }

  if (hps >= 1_000_000) {
    return (hps / 1_000_000).toFixed(2) + " MH/s";
  }

  if (hps >= 1_000) {
    return (hps / 1_000).toFixed(2) + " kH/s";
  }

  return hps.toFixed(1) + " H/s";
}
