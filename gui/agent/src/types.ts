export interface WorkerConfig {
  id: string;
  label: string;
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

export function emptyWorker(label: string): WorkerConfig {
  return {
    id: crypto.randomUUID(),
    label,
    pool_url: "stratum+tcp://1pool.sugarchain.org:3333",
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
  if (hps >= 1_000_000) return (hps / 1_000_000).toFixed(2) + " MH/s";
  if (hps >= 1_000) return (hps / 1_000).toFixed(2) + " kH/s";
  return hps.toFixed(1) + " H/s";
}
