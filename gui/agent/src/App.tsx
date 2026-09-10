import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import WorkerCard from "./components/WorkerCard";
import ConfigEditor from "./components/ConfigEditor";
import {
  WorkerConfig,
  WorkerStats,
  RigInfo,
  emptyWorker,
  formatHashrate,
} from "./types";

interface DashboardConnection {
  ip: string;
  port: number;
  websocket_url: string;
}

interface BenchmarkResult {
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

type BenchmarkAlgorithm = "YespowerMwc" | "YespowerAdvc";

const BENCHMARK_ALGORITHMS: BenchmarkAlgorithm[] = [
  "YespowerMwc",
  "YespowerAdvc",
];

const BENCHMARK_DURATIONS = [30, 60];

export default function App() {
  const [workers, setWorkers] = useState<WorkerConfig[]>([]);
  const [stats, setStats] = useState<Record<string, WorkerStats>>({});
  const [rig, setRig] = useState<RigInfo | null>(null);
  const [connection, setConnection] =
    useState<DashboardConnection | null>(null);
  const [editing, setEditing] = useState<WorkerConfig | null>(null);

  const [benchmarkAlgorithm, setBenchmarkAlgorithm] =
    useState<BenchmarkAlgorithm>("YespowerMwc");

  const [benchmarkThreads, setBenchmarkThreads] = useState<number>(1);

  const [benchmarkDuration, setBenchmarkDuration] =
    useState<number>(30);

  const [benchmarkRunning, setBenchmarkRunning] =
    useState<boolean>(false);

  const [benchmarkResult, setBenchmarkResult] =
    useState<BenchmarkResult | null>(null);

  const [benchmarkError, setBenchmarkError] =
    useState<string | null>(null);

  const [benchmarkElapsed, setBenchmarkElapsed] =
    useState<number>(0);

  async function refresh() {
    try {
      const [w, s] = await Promise.all([
        invoke<WorkerConfig[]>("list_workers"),
        invoke<Record<string, WorkerStats>>("get_stats"),
      ]);

      setWorkers(w);
      setStats(s);
    } catch (error) {
      console.error("Failed to refresh worker information:", error);
    }
  }

  async function loadConnectionInfo() {
    try {
      const info = await invoke<DashboardConnection>(
        "get_dashboard_connection"
      );

      setConnection(info);
    } catch (error) {
      console.error("Failed to get dashboard connection info:", error);
    }
  }

  useEffect(() => {
    refresh();
    invoke<RigInfo>("get_rig_info")
      .then((info) => {
        setRig(info);

        if (info.logical_cores > 0) {
          setBenchmarkThreads(1);
        }
      })
      .catch((error) => {
        console.error("Failed to get rig information:", error);
      });

    loadConnectionInfo();

    const interval = setInterval(refresh, 1500);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!benchmarkRunning) {
      return;
    }

    const interval = window.setInterval(() => {
      setBenchmarkElapsed((current) => {
        if (current >= benchmarkDuration) {
          return current;
        }

        return current + 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [benchmarkRunning, benchmarkDuration]);

  useEffect(() => {
    if (!rig) {
      return;
    }

    if (rig.logical_cores > 0 && benchmarkThreads > rig.logical_cores) {
      setBenchmarkThreads(rig.logical_cores);
    }

    if (benchmarkThreads < 1) {
      setBenchmarkThreads(1);
    }
  }, [rig, benchmarkThreads]);

  async function handleStart(id: string) {
    try {
      await invoke("start_worker", { id });
      await refresh();
    } catch (error) {
      console.error("Failed to start worker:", error);
    }
  }

  async function handleStop(id: string) {
    try {
      await invoke("stop_worker", { id });
      await refresh();
    } catch (error) {
      console.error("Failed to stop worker:", error);
    }
  }

  async function handleSave(config: WorkerConfig) {
    try {
      await invoke("upsert_worker", { config });
      setEditing(null);
      await refresh();
    } catch (error) {
      console.error("Failed to save worker:", error);
    }
  }

  async function handleRemove(id: string) {
    try {
      await invoke("remove_worker", { id });
      await refresh();
    } catch (error) {
      console.error("Failed to remove worker:", error);
    }
  }

  async function handleRunBenchmark() {
    if (benchmarkRunning) {
      return;
    }

    setBenchmarkRunning(true);
    setBenchmarkError(null);
    setBenchmarkResult(null);
    setBenchmarkElapsed(0);

    try {
      const result = await invoke<BenchmarkResult>(
        "run_benchmark",
        {
          algorithm: benchmarkAlgorithm,
          threads: benchmarkThreads,
          duration: benchmarkDuration,
        }
      );

      setBenchmarkResult(result);
      setBenchmarkElapsed(benchmarkDuration);
    } catch (error) {
      console.error("Benchmark failed:", error);

      setBenchmarkError(
        error instanceof Error
          ? error.message
          : String(error)
      );
    } finally {
      setBenchmarkRunning(false);
    }
  }

  function handleBenchmarkThreadsChange(
    value: string
  ) {
    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed)) {
      return;
    }

    const maxThreads = rig?.logical_cores || 1;

    setBenchmarkThreads(
      Math.min(
        Math.max(parsed, 1),
        maxThreads
      )
    );
  }

  const totalHashrate = Object.values(stats).reduce(
    (sum, s) =>
      sum + (s.total_hashrate_hps || 0),
    0
  );

  const benchmarkProgress = useMemo(() => {
    if (!benchmarkRunning) {
      return benchmarkResult ? 100 : 0;
    }

    if (benchmarkDuration <= 0) {
      return 0;
    }

    return Math.min(
      100,
      (benchmarkElapsed / benchmarkDuration) * 100
    );
  }, [
    benchmarkRunning,
    benchmarkElapsed,
    benchmarkDuration,
    benchmarkResult,
  ]);

  const benchmarkRemaining = Math.max(
    0,
    benchmarkDuration - benchmarkElapsed
  );

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>{rig?.hostname ?? "this rig"}</h1>

          <span className="subtle">
            {rig
              ? `${rig.cpu_brand} · ${rig.logical_cores} threads · ${rig.os}/${rig.arch}`
              : ""}
          </span>
        </div>

        <div className="header-right">
          <div className="total-hashrate">
            {formatHashrate(totalHashrate)} total
          </div>

          {connection && (
            <div className="dashboard-connection">
              <div className="connection-title">
                <span className="connection-dot" />
                Dashboard Connection
              </div>

              <div className="connection-details">
                <span>
                  <strong>IP</strong> {connection.ip}
                </span>

                <span>
                  <strong>Port</strong> {connection.port}
                </span>
              </div>
            </div>
          )}
        </div>
      </header>

      <section
        className="benchmark-panel"
        style={{
          background: "#1a1b1f",
          border: "1px solid #2a2b30",
          borderRadius: "10px",
          padding: "18px",
          marginBottom: "20px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "16px",
            marginBottom: "16px",
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: "18px",
                fontWeight: 600,
              }}
            >
              CPU Benchmark
            </h2>

            <div
              className="subtle"
              style={{ marginTop: "4px" }}
            >
              Test your CPU performance with the MWC-compatible
              Yespower algorithms.
            </div>
          </div>

          {benchmarkRunning && (
            <div
              style={{
                fontSize: "12px",
                color: "#aaa",
                whiteSpace: "nowrap",
              }}
            >
              Benchmark running...
            </div>
          )}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "minmax(150px, 1fr) minmax(120px, 160px) minmax(120px, 160px) auto",
            gap: "10px",
            alignItems: "end",
          }}
        >
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "5px",
              fontSize: "12px",
              color: "#aaa",
            }}
          >
            Algorithm

            <select
              value={benchmarkAlgorithm}
              disabled={benchmarkRunning}
              onChange={(event) =>
                setBenchmarkAlgorithm(
                  event.target.value as BenchmarkAlgorithm
                )
              }
              style={{
                background: "#101114",
                border: "1px solid #333",
                color: "#e6e6e6",
                padding: "7px 8px",
                borderRadius: "6px",
                fontSize: "12px",
              }}
            >
              {BENCHMARK_ALGORITHMS.map((algorithm) => (
                <option
                  key={algorithm}
                  value={algorithm}
                >
                  {algorithm}
                </option>
              ))}
            </select>
          </label>

          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "5px",
              fontSize: "12px",
              color: "#aaa",
            }}
          >
            Threads

            <input
              type="number"
              min={1}
              max={rig?.logical_cores || undefined}
              value={benchmarkThreads}
              disabled={benchmarkRunning}
              onChange={(event) =>
                handleBenchmarkThreadsChange(
                  event.target.value
                )
              }
              style={{
                background: "#101114",
                border: "1px solid #333",
                color: "#e6e6e6",
                padding: "7px 8px",
                borderRadius: "6px",
                fontSize: "12px",
              }}
            />
          </label>

          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "5px",
              fontSize: "12px",
              color: "#aaa",
            }}
          >
            Duration

            <select
              value={benchmarkDuration}
              disabled={benchmarkRunning}
              onChange={(event) =>
                setBenchmarkDuration(
                  Number.parseInt(
                    event.target.value,
                    10
                  )
                )
              }
              style={{
                background: "#101114",
                border: "1px solid #333",
                color: "#e6e6e6",
                padding: "7px 8px",
                borderRadius: "6px",
                fontSize: "12px",
              }}
            >
              {BENCHMARK_DURATIONS.map((duration) => (
                <option
                  key={duration}
                  value={duration}
                >
                  {duration} seconds
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={handleRunBenchmark}
            disabled={benchmarkRunning}
            style={{
              minHeight: "31px",
              padding: "7px 14px",
              fontWeight: 600,
              opacity: benchmarkRunning ? 0.6 : 1,
              cursor: benchmarkRunning
                ? "default"
                : "pointer",
            }}
          >
            {benchmarkRunning
              ? "Running..."
              : "Start Benchmark"}
          </button>
        </div>

        {benchmarkRunning && (
          <div style={{ marginTop: "16px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "6px",
                fontSize: "11px",
                color: "#888",
              }}
            >
              <span>
                Testing {benchmarkAlgorithm} with{" "}
                {benchmarkThreads}{" "}
                {benchmarkThreads === 1
                  ? "thread"
                  : "threads"}
              </span>

              <span>
                {benchmarkRemaining}s remaining
              </span>
            </div>

            <div
              style={{
                height: "6px",
                background: "#101114",
                borderRadius: "999px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${benchmarkProgress}%`,
                  height: "100%",
                  background: "#3ddc84",
                  transition: "width 1s linear",
                }}
              />
            </div>
          </div>
        )}

        {benchmarkError && (
          <div
            style={{
              marginTop: "14px",
              background: "#301b1b",
              border: "1px solid #4a2929",
              borderRadius: "7px",
              padding: "10px",
              color: "#ff9d9d",
              fontSize: "12px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            <strong>Benchmark failed:</strong>{" "}
            {benchmarkError}
          </div>
        )}

        {benchmarkResult && !benchmarkRunning && (
          <div
            style={{
              marginTop: "16px",
              borderTop: "1px solid #2a2b30",
              paddingTop: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "13px",
                    color: "#888",
                  }}
                >
                  Benchmark Result
                </div>

                <div
                  style={{
                    fontSize: "22px",
                    fontWeight: 700,
                    marginTop: "2px",
                  }}
                >
                  {formatHashrate(
                    benchmarkResult.benchmark.hashrate_hps
                  )}
                </div>
              </div>

              <div
                style={{
                  textAlign: "right",
                  fontSize: "12px",
                  color: "#aaa",
                }}
              >
                <div>
                  {benchmarkResult.benchmark.algorithm}
                </div>

                <div>
                  {benchmarkResult.benchmark.threads}{" "}
                  {benchmarkResult.benchmark.threads === 1
                    ? "thread"
                    : "threads"}{" "}
                  ·{" "}
                  {benchmarkResult.benchmark.duration_seconds}s
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(150px, 1fr))",
                gap: "10px",
              }}
            >
              <div
                style={{
                  background: "#101114",
                  borderRadius: "7px",
                  padding: "10px",
                }}
              >
                <span className="stat-label">
                  Per Thread
                </span>

                <span className="stat-value">
                  {formatHashrate(
                    benchmarkResult.benchmark
                      .per_thread_hps
                  )}
                </span>
              </div>

              <div
                style={{
                  background: "#101114",
                  borderRadius: "7px",
                  padding: "10px",
                }}
              >
                <span className="stat-label">
                  CPU
                </span>

                <span
                  className="stat-value"
                  style={{
                    fontSize: "13px",
                    wordBreak: "break-word",
                  }}
                >
                  {benchmarkResult.benchmark.cpu}
                </span>
              </div>

              <div
                style={{
                  background: "#101114",
                  borderRadius: "7px",
                  padding: "10px",
                }}
              >
                <span className="stat-label">
                  Architecture
                </span>

                <span className="stat-value">
                  {benchmarkResult.benchmark.architecture}
                </span>
              </div>

              <div
                style={{
                  background: "#101114",
                  borderRadius: "7px",
                  padding: "10px",
                }}
              >
                <span className="stat-label">
                  Operating System
                </span>

                <span className="stat-value">
                  {benchmarkResult.benchmark.os}
                </span>
              </div>
            </div>

            <div
              style={{
                marginTop: "10px",
                fontSize: "10px",
                color: "#666",
              }}
            >
              Completed{" "}
              {new Date(
                benchmarkResult.benchmark.timestamp
              ).toLocaleString()}
              {" · "}
              Sugarmaker{" "}
              {benchmarkResult.benchmark
                .sugarmaker_version}
            </div>
          </div>
        )}
      </section>

      <div className="worker-grid">
        {workers.map((w) => (
          <WorkerCard
            key={w.id}
            config={w}
            stats={stats[w.id]}
            onStart={handleStart}
            onStop={handleStop}
            onEdit={setEditing}
            onRemove={handleRemove}
          />
        ))}

        <button
          className="add-worker"
          onClick={() =>
            setEditing(
              emptyWorker(
                `Worker ${workers.length + 1}`
              )
            )
          }
        >
          + Add worker
        </button>
      </div>

      {editing && (
        <ConfigEditor
          initial={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
