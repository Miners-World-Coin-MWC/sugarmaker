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

interface CommunityBenchmark {
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
}

interface CommunityBenchmarkFile {
  schema_version: number;
  benchmarks: CommunityBenchmark[];
}

interface GitHubContentResponse {
  content?: string;
  encoding?: string;
}

type BenchmarkAlgorithm =
  | "YespowerMwc"
  | "YespowerAdvc";

const BENCHMARK_ALGORITHMS: BenchmarkAlgorithm[] = [
  "YespowerMwc",
  "YespowerAdvc",
];

const BENCHMARK_DURATIONS = [30, 60];

/*
 * Read-only GitHub API endpoint.
 *
 * IMPORTANT:
 * The benchmark system is currently being developed on the
 * Benchmark-system branch, so the Agent explicitly reads from
 * that branch instead of the repository default/main branch.
 *
 * The Agent never writes to GitHub.
 */
const COMMUNITY_BENCHMARK_URL =
  "https://api.github.com/repos/Miners-World-Coin-MWC/sugarmaker/contents/benchmarks/benchmark.json?ref=Benchmark-system";

function decodeGitHubContent(content: string): string {
  const cleaned = content.replace(/\s/g, "");
  const binary = window.atob(cleaned);

  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new TextDecoder("utf-8").decode(bytes);
}

function normaliseCommunityBenchmark(
  value: unknown
): CommunityBenchmark | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Record<string, unknown>;

  if (
    typeof item.algorithm !== "string" ||
    typeof item.cpu !== "string" ||
    typeof item.architecture !== "string" ||
    typeof item.os !== "string" ||
    typeof item.threads !== "number" ||
    typeof item.hashrate_hps !== "number" ||
    typeof item.per_thread_hps !== "number" ||
    typeof item.duration_seconds !== "number" ||
    typeof item.sugarmaker_version !== "string" ||
    typeof item.timestamp !== "string"
  ) {
    return null;
  }

  return {
    algorithm: item.algorithm,
    cpu: item.cpu,
    architecture: item.architecture,
    os: item.os,
    threads: item.threads,
    hashrate_hps: item.hashrate_hps,
    per_thread_hps: item.per_thread_hps,
    duration_seconds: item.duration_seconds,
    sugarmaker_version: item.sugarmaker_version,
    timestamp: item.timestamp,
  };
}

export default function App() {
  const [workers, setWorkers] = useState<WorkerConfig[]>([]);
  const [stats, setStats] =
    useState<Record<string, WorkerStats>>({});
  const [rig, setRig] =
    useState<RigInfo | null>(null);
  const [connection, setConnection] =
    useState<DashboardConnection | null>(null);
  const [editing, setEditing] =
    useState<WorkerConfig | null>(null);

  const [benchmarkAlgorithm, setBenchmarkAlgorithm] =
    useState<BenchmarkAlgorithm>("YespowerMwc");

  const [benchmarkThreads, setBenchmarkThreads] =
    useState<number>(1);

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

  /*
   * Local benchmark result state.
   *
   * A successful run_benchmark call means the Rust backend
   * has already created/overwritten benchmark-result.json.
   *
   * This is also restored from disk when the Agent starts.
   */
  const [localResultSaved, setLocalResultSaved] =
    useState<boolean>(false);

  const [openingLocalResult, setOpeningLocalResult] =
    useState<boolean>(false);

  const [localResultError, setLocalResultError] =
    useState<string | null>(null);

  /*
   * Community benchmark state.
   */
  const [communityBenchmarks, setCommunityBenchmarks] =
    useState<CommunityBenchmark[]>([]);

  const [communityLoading, setCommunityLoading] =
    useState<boolean>(false);

  const [communityError, setCommunityError] =
    useState<string | null>(null);

  const [selectedCommunityCpu, setSelectedCommunityCpu] =
    useState<string>("");

  async function refresh() {
    try {
      const [w, s] = await Promise.all([
        invoke<WorkerConfig[]>("list_workers"),
        invoke<Record<string, WorkerStats>>(
          "get_stats"
        ),
      ]);

      setWorkers(w);
      setStats(s);
    } catch (error) {
      console.error(
        "Failed to refresh worker information:",
        error
      );
    }
  }

  async function loadConnectionInfo() {
    try {
      const info =
        await invoke<DashboardConnection>(
          "get_dashboard_connection"
        );

      setConnection(info);
    } catch (error) {
      console.error(
        "Failed to get dashboard connection info:",
        error
      );
    }
  }

  /*
   * Load the locally saved benchmark result.
   *
   * This is called when the Agent starts so the last
   * successful benchmark survives application restarts.
   */
  async function loadSavedBenchmarkResult() {
    try {
      const result =
        await invoke<BenchmarkResult | null>(
          "get_saved_benchmark_result"
        );

      if (!result) {
        setBenchmarkResult(null);
        setLocalResultSaved(false);
        return;
      }

      setBenchmarkResult(result);
      setLocalResultSaved(true);
      setLocalResultError(null);

      /*
       * Restore the algorithm used by the saved result.
       *
       * Only accept algorithms supported by the GUI.
       */
      if (
        result.benchmark.algorithm ===
          "YespowerMwc" ||
        result.benchmark.algorithm ===
          "YespowerAdvc"
      ) {
        setBenchmarkAlgorithm(
          result.benchmark
            .algorithm as BenchmarkAlgorithm
        );
      }

      /*
       * Restore the thread count where possible.
       *
       * The rig validation effect below will clamp this
       * to the available logical CPU count.
       */
      if (
        Number.isFinite(
          result.benchmark.threads
        ) &&
        result.benchmark.threads > 0
      ) {
        setBenchmarkThreads(
          result.benchmark.threads
        );
      }

      /*
       * Restore the duration selector when the saved
       * duration matches one of the supported GUI values.
       */
      if (
        BENCHMARK_DURATIONS.includes(
          result.benchmark
            .duration_seconds
        )
      ) {
        setBenchmarkDuration(
          result.benchmark
            .duration_seconds
        );
      }
    } catch (error) {
      console.error(
        "Failed to load saved benchmark result:",
        error
      );

      /*
       * Do not destroy the existing GUI state if the
       * local file cannot be read. Simply report the
       * error in the console for now.
       */
      setLocalResultSaved(false);
    }
  }

  /*
   * Load the community benchmark file from GitHub.
   *
   * This is intentionally read-only.
   * Nothing is uploaded or changed here.
   *
   * The benchmark data is currently read from the
   * Benchmark-system branch rather than main/default.
   */
  async function loadCommunityBenchmarks() {
    setCommunityLoading(true);
    setCommunityError(null);

    try {
      const response = await fetch(
        COMMUNITY_BENCHMARK_URL,
        {
          method: "GET",
          headers: {
            Accept:
              "application/vnd.github+json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          `GitHub returned HTTP ${response.status}`
        );
      }

      const githubData =
        (await response.json()) as GitHubContentResponse;

      if (!githubData.content) {
        throw new Error(
          "GitHub did not return benchmark.json content."
        );
      }

      const jsonText =
        decodeGitHubContent(
          githubData.content
        );

      const parsed =
        JSON.parse(
          jsonText
        ) as CommunityBenchmarkFile;

      if (
        !parsed ||
        !Array.isArray(parsed.benchmarks)
      ) {
        throw new Error(
          "benchmark.json has an invalid format."
        );
      }

      const validBenchmarks =
        parsed.benchmarks
          .map(
            normaliseCommunityBenchmark
          )
          .filter(
            (
              benchmark
            ): benchmark is CommunityBenchmark =>
              benchmark !== null
          );

      setCommunityBenchmarks(
        validBenchmarks
      );
    } catch (error) {
      console.error(
        "Failed to load community benchmarks:",
        error
      );

      setCommunityBenchmarks([]);

      setCommunityError(
        error instanceof Error
          ? error.message
          : String(error)
      );
    } finally {
      setCommunityLoading(false);
    }
  }

  useEffect(() => {
    refresh();

    /*
     * Restore the most recent local benchmark.
     *
     * This does not execute a benchmark.
     * It only reads benchmark-result.json.
     */
    loadSavedBenchmarkResult();

    invoke<RigInfo>("get_rig_info")
      .then((info) => {
        setRig(info);

        if (info.logical_cores > 0) {
          /*
           * Keep the existing default behaviour for
           * a rig that has no previously saved result.
           *
           * loadSavedBenchmarkResult() may subsequently
           * restore the saved thread count.
           */
          setBenchmarkThreads(
            (current) =>
              current > info.logical_cores
                ? info.logical_cores
                : current
          );
        }
      })
      .catch((error) => {
        console.error(
          "Failed to get rig information:",
          error
        );
      });

    loadConnectionInfo();

    const interval = setInterval(
      refresh,
      1500
    );

    return () =>
      clearInterval(interval);
  }, []);

  /*
   * Load community results when the selected
   * benchmark algorithm changes.
   */
  useEffect(() => {
    loadCommunityBenchmarks();
  }, [benchmarkAlgorithm]);

  useEffect(() => {
    if (!benchmarkRunning) {
      return;
    }

    const interval = window.setInterval(
      () => {
        setBenchmarkElapsed(
          (current) => {
            if (
              current >=
              benchmarkDuration
            ) {
              return current;
            }

            return current + 1;
          }
        );
      },
      1000
    );

    return () =>
      window.clearInterval(interval);
  }, [
    benchmarkRunning,
    benchmarkDuration,
  ]);

  useEffect(() => {
    if (!rig) {
      return;
    }

    if (
      rig.logical_cores > 0 &&
      benchmarkThreads >
        rig.logical_cores
    ) {
      setBenchmarkThreads(
        rig.logical_cores
      );
    }

    if (benchmarkThreads < 1) {
      setBenchmarkThreads(1);
    }
  }, [
    rig,
    benchmarkThreads,
  ]);

  async function handleStart(
    id: string
  ) {
    try {
      await invoke(
        "start_worker",
        { id }
      );

      await refresh();
    } catch (error) {
      console.error(
        "Failed to start worker:",
        error
      );
    }
  }

  async function handleStop(
    id: string
  ) {
    try {
      await invoke(
        "stop_worker",
        { id }
      );

      await refresh();
    } catch (error) {
      console.error(
        "Failed to stop worker:",
        error
      );
    }
  }

  async function handleSave(
    config: WorkerConfig
  ) {
    try {
      await invoke(
        "upsert_worker",
        { config }
      );

      setEditing(null);

      await refresh();
    } catch (error) {
      console.error(
        "Failed to save worker:",
        error
      );
    }
  }

  async function handleRemove(
    id: string
  ) {
    try {
      await invoke(
        "remove_worker",
        { id }
      );

      await refresh();
    } catch (error) {
      console.error(
        "Failed to remove worker:",
        error
      );
    }
  }

  async function handleRunBenchmark() {
    if (benchmarkRunning) {
      return;
    }

    setBenchmarkRunning(true);
    setBenchmarkError(null);
    setLocalResultError(null);
    setLocalResultSaved(false);
    setBenchmarkResult(null);
    setBenchmarkElapsed(0);

    try {
      /*
       * The Rust backend now:
       *
       * 1. Runs sugarmaker-benchmark
       * 2. Parses BENCHMARK_RESULT
       * 3. Builds the local result
       * 4. Saves benchmark-result.json
       * 5. Returns the result here
       */
      const result =
        await invoke<BenchmarkResult>(
          "run_benchmark",
          {
            algorithm:
              benchmarkAlgorithm,
            threads:
              benchmarkThreads,
            duration:
              benchmarkDuration,
          }
        );

      setBenchmarkResult(result);

      /*
       * If run_benchmark succeeded, the local result
       * was successfully saved by the backend.
       */
      setLocalResultSaved(true);

      setBenchmarkElapsed(
        benchmarkDuration
      );
    } catch (error) {
      console.error(
        "Benchmark failed:",
        error
      );

      setBenchmarkError(
        error instanceof Error
          ? error.message
          : String(error)
      );

      setLocalResultSaved(false);
    } finally {
      setBenchmarkRunning(false);
    }
  }

  /*
   * Open the locally saved benchmark-result.json
   * using the operating system's default application.
   */
  async function handleOpenBenchmarkResult() {
    if (openingLocalResult) {
      return;
    }

    setOpeningLocalResult(true);
    setLocalResultError(null);

    try {
      await invoke(
        "open_benchmark_result"
      );
    } catch (error) {
      console.error(
        "Failed to open local benchmark result:",
        error
      );

      setLocalResultError(
        error instanceof Error
          ? error.message
          : String(error)
      );
    } finally {
      setOpeningLocalResult(false);
    }
  }

  function handleBenchmarkThreadsChange(
    value: string
  ) {
    const parsed =
      Number.parseInt(
        value,
        10
      );

    if (!Number.isFinite(parsed)) {
      return;
    }

    const maxThreads =
      rig?.logical_cores || 1;

    setBenchmarkThreads(
      Math.min(
        Math.max(
          parsed,
          1
        ),
        maxThreads
      )
    );
  }

  const totalHashrate =
    Object.values(stats).reduce(
      (sum, s) =>
        sum +
        (s.total_hashrate_hps || 0),
      0
    );

  const benchmarkProgress =
    useMemo(() => {
      if (!benchmarkRunning) {
        return benchmarkResult
          ? 100
          : 0;
      }

      if (
        benchmarkDuration <= 0
      ) {
        return 0;
      }

      return Math.min(
        100,
        (benchmarkElapsed /
          benchmarkDuration) *
          100
      );
    }, [
      benchmarkRunning,
      benchmarkElapsed,
      benchmarkDuration,
      benchmarkResult,
    ]);

  const benchmarkRemaining =
    Math.max(
      0,
      benchmarkDuration -
        benchmarkElapsed
    );

  /*
   * Community results for the currently
   * selected algorithm.
   */
  const filteredCommunityBenchmarks =
    useMemo(() => {
      return communityBenchmarks
        .filter(
          (benchmark) =>
            benchmark.algorithm ===
            benchmarkAlgorithm
        )
        .sort((a, b) => {
          if (a.cpu < b.cpu) {
            return -1;
          }

          if (a.cpu > b.cpu) {
            return 1;
          }

          return (
            b.per_thread_hps -
            a.per_thread_hps
          );
        });
    }, [
      communityBenchmarks,
      benchmarkAlgorithm,
    ]);

  /*
   * Unique CPU list for the selector.
   */
  const communityCpuOptions =
    useMemo(() => {
      return Array.from(
        new Set(
          filteredCommunityBenchmarks.map(
            (benchmark) =>
              benchmark.cpu
          )
        )
      ).sort((a, b) =>
        a.localeCompare(b)
      );
    }, [
      filteredCommunityBenchmarks,
    ]);

  /*
   * Automatically choose a CPU when the available
   * community data changes.
   *
   * Prefer the local CPU if it exists.
   */
  useEffect(() => {
    if (
      communityCpuOptions.length === 0
    ) {
      setSelectedCommunityCpu("");
      return;
    }

    if (
      benchmarkResult &&
      communityCpuOptions.includes(
        benchmarkResult
          .benchmark
          .cpu
      )
    ) {
      setSelectedCommunityCpu(
        benchmarkResult
          .benchmark
          .cpu
      );
      return;
    }

    if (
      selectedCommunityCpu &&
      communityCpuOptions.includes(
        selectedCommunityCpu
      )
    ) {
      return;
    }

    setSelectedCommunityCpu(
      communityCpuOptions[0]
    );
  }, [
    communityCpuOptions,
    benchmarkResult,
    selectedCommunityCpu,
  ]);

  /*
   * Select the most appropriate community result
   * for the chosen CPU.
   *
   * Priority:
   * 1. Same CPU + architecture + OS + threads
   * 2. Same CPU + architecture + OS
   * 3. Best per-thread result for that CPU
   */
  const selectedCommunityBenchmark =
    useMemo(() => {
      if (!selectedCommunityCpu) {
        return null;
      }

      const cpuResults =
        filteredCommunityBenchmarks.filter(
          (benchmark) =>
            benchmark.cpu ===
            selectedCommunityCpu
        );

      if (cpuResults.length === 0) {
        return null;
      }

      if (benchmarkResult) {
        const local =
          benchmarkResult.benchmark;

        const exactMatch =
          cpuResults.find(
            (benchmark) =>
              benchmark.architecture ===
                local.architecture &&
              benchmark.os ===
                local.os &&
              benchmark.threads ===
                local.threads
          );

        if (exactMatch) {
          return exactMatch;
        }

        const platformMatch =
          cpuResults.find(
            (benchmark) =>
              benchmark.architecture ===
                local.architecture &&
              benchmark.os ===
                local.os
          );

        if (platformMatch) {
          return platformMatch;
        }
      }

      return [
        ...cpuResults,
      ].sort(
        (a, b) =>
          b.per_thread_hps -
          a.per_thread_hps
      )[0];
    }, [
      filteredCommunityBenchmarks,
      selectedCommunityCpu,
      benchmarkResult,
    ]);

  /*
   * Per-thread comparison.
   *
   * This remains meaningful even if the local and
   * community benchmark use different thread counts.
   */
  const perThreadDifference =
    useMemo(() => {
      if (
        !benchmarkResult ||
        !selectedCommunityBenchmark
      ) {
        return null;
      }

      const local =
        benchmarkResult
          .benchmark
          .per_thread_hps;

      const community =
        selectedCommunityBenchmark
          .per_thread_hps;

      if (
        !Number.isFinite(local) ||
        !Number.isFinite(
          community
        ) ||
        community <= 0
      ) {
        return null;
      }

      return (
        ((local - community) /
          community) *
        100
      );
    }, [
      benchmarkResult,
      selectedCommunityBenchmark,
    ]);

  /*
   * Total-hashrate comparison is only shown when
   * both tests used the same number of threads.
   */
  const totalDifference =
    useMemo(() => {
      if (
        !benchmarkResult ||
        !selectedCommunityBenchmark
      ) {
        return null;
      }

      const local =
        benchmarkResult.benchmark;

      const community =
        selectedCommunityBenchmark;

      if (
        local.threads !==
        community.threads
      ) {
        return null;
      }

      if (
        !Number.isFinite(
          community.hashrate_hps
        ) ||
        community.hashrate_hps <= 0
      ) {
        return null;
      }

      return (
        ((local.hashrate_hps -
          community.hashrate_hps) /
          community.hashrate_hps) *
        100
      );
    }, [
      benchmarkResult,
      selectedCommunityBenchmark,
    ]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>
            {rig?.hostname ??
              "this rig"}
          </h1>

          <span className="subtle">
            {rig
              ? `${rig.cpu_brand} · ${rig.logical_cores} threads · ${rig.os}/${rig.arch}`
              : ""}
          </span>
        </div>

        <div className="header-right">
          <div className="total-hashrate">
            {formatHashrate(
              totalHashrate
            )}{" "}
            total
          </div>

          {connection && (
            <div className="dashboard-connection">
              <div className="connection-title">
                <span className="connection-dot" />
                Dashboard Connection
              </div>

              <div className="connection-details">
                <span>
                  <strong>IP</strong>{" "}
                  {connection.ip}
                </span>

                <span>
                  <strong>Port</strong>{" "}
                  {connection.port}
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
          border:
            "1px solid #2a2b30",
          borderRadius: "10px",
          padding: "18px",
          marginBottom: "20px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent:
              "space-between",
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
              style={{
                marginTop: "4px",
              }}
            >
              Test your CPU performance
              with the MWC-compatible
              Yespower algorithms.
            </div>
          </div>

          {benchmarkRunning && (
            <div
              style={{
                fontSize: "12px",
                color: "#aaa",
                whiteSpace:
                  "nowrap",
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
              flexDirection:
                "column",
              gap: "5px",
              fontSize: "12px",
              color: "#aaa",
            }}
          >
            Algorithm

            <select
              value={
                benchmarkAlgorithm
              }
              disabled={
                benchmarkRunning
              }
              onChange={(event) =>
                setBenchmarkAlgorithm(
                  event.target
                    .value as BenchmarkAlgorithm
                )
              }
              style={{
                background:
                  "#101114",
                border:
                  "1px solid #333",
                color:
                  "#e6e6e6",
                padding:
                  "7px 8px",
                borderRadius:
                  "6px",
                fontSize:
                  "12px",
              }}
            >
              {BENCHMARK_ALGORITHMS.map(
                (algorithm) => (
                  <option
                    key={algorithm}
                    value={algorithm}
                  >
                    {algorithm}
                  </option>
                )
              )}
            </select>
          </label>

          <label
            style={{
              display: "flex",
              flexDirection:
                "column",
              gap: "5px",
              fontSize: "12px",
              color: "#aaa",
            }}
          >
            Threads

            <input
              type="number"
              min={1}
              max={
                rig?.logical_cores ||
                undefined
              }
              value={
                benchmarkThreads
              }
              disabled={
                benchmarkRunning
              }
              onChange={(event) =>
                handleBenchmarkThreadsChange(
                  event.target.value
                )
              }
              style={{
                background:
                  "#101114",
                border:
                  "1px solid #333",
                color:
                  "#e6e6e6",
                padding:
                  "7px 8px",
                borderRadius:
                  "6px",
                fontSize:
                  "12px",
              }}
            />
          </label>

          <label
            style={{
              display: "flex",
              flexDirection:
                "column",
              gap: "5px",
              fontSize: "12px",
              color: "#aaa",
            }}
          >
            Duration

            <select
              value={
                benchmarkDuration
              }
              disabled={
                benchmarkRunning
              }
              onChange={(event) =>
                setBenchmarkDuration(
                  Number.parseInt(
                    event.target
                      .value,
                    10
                  )
                )
              }
              style={{
                background:
                  "#101114",
                border:
                  "1px solid #333",
                color:
                  "#e6e6e6",
                padding:
                  "7px 8px",
                borderRadius:
                  "6px",
                fontSize:
                  "12px",
              }}
            >
              {BENCHMARK_DURATIONS.map(
                (duration) => (
                  <option
                    key={duration}
                    value={duration}
                  >
                    {duration} seconds
                  </option>
                )
              )}
            </select>
          </label>

          <button
            onClick={
              handleRunBenchmark
            }
            disabled={
              benchmarkRunning
            }
            style={{
              minHeight: "31px",
              padding:
                "7px 14px",
              fontWeight: 600,
              opacity:
                benchmarkRunning
                  ? 0.6
                  : 1,
              cursor:
                benchmarkRunning
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
          <div
            style={{
              marginTop: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                marginBottom:
                  "6px",
                fontSize: "11px",
                color: "#888",
              }}
            >
              <span>
                Testing{" "}
                {
                  benchmarkAlgorithm
                }{" "}
                with{" "}
                {
                  benchmarkThreads
                }{" "}
                {benchmarkThreads ===
                1
                  ? "thread"
                  : "threads"}
              </span>

              <span>
                {
                  benchmarkRemaining
                }
                s remaining
              </span>
            </div>

            <div
              style={{
                height: "6px",
                background:
                  "#101114",
                borderRadius:
                  "999px",
                overflow:
                  "hidden",
              }}
            >
              <div
                style={{
                  width: `${benchmarkProgress}%`,
                  height: "100%",
                  background:
                    "#3ddc84",
                  transition:
                    "width 1s linear",
                }}
              />
            </div>
          </div>
        )}

        {benchmarkError && (
          <div
            style={{
              marginTop: "14px",
              background:
                "#301b1b",
              border:
                "1px solid #4a2929",
              borderRadius:
                "7px",
              padding: "10px",
              color:
                "#ff9d9d",
              fontSize:
                "12px",
              whiteSpace:
                "pre-wrap",
              wordBreak:
                "break-word",
            }}
          >
            <strong>
              Benchmark failed:
            </strong>{" "}
            {benchmarkError}
          </div>
        )}

        {benchmarkResult &&
          !benchmarkRunning && (
            <div
              style={{
                marginTop:
                  "16px",
                borderTop:
                  "1px solid #2a2b30",
                paddingTop:
                  "16px",
              }}
            >
              <div
                style={{
                  display:
                    "flex",
                  justifyContent:
                    "space-between",
                  alignItems:
                    "center",
                  gap: "16px",
                  marginBottom:
                    "12px",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize:
                        "13px",
                      color:
                        "#888",
                    }}
                  >
                    Benchmark Result
                  </div>

                  <div
                    style={{
                      fontSize:
                        "22px",
                      fontWeight:
                        700,
                      marginTop:
                        "2px",
                    }}
                  >
                    {formatHashrate(
                      benchmarkResult
                        .benchmark
                        .hashrate_hps
                    )}
                  </div>
                </div>

                <div
                  style={{
                    display:
                      "flex",
                    alignItems:
                      "center",
                    gap: "10px",
                  }}
                >
                  <div
                    style={{
                      textAlign:
                        "right",
                      fontSize:
                        "12px",
                      color:
                        "#aaa",
                    }}
                  >
                    <div>
                      {
                        benchmarkResult
                          .benchmark
                          .algorithm
                      }
                    </div>

                    <div>
                      {
                        benchmarkResult
                          .benchmark
                          .threads
                      }{" "}
                      {benchmarkResult
                        .benchmark
                        .threads ===
                      1
                        ? "thread"
                        : "threads"}{" "}
                      ·{" "}
                      {
                        benchmarkResult
                          .benchmark
                          .duration_seconds
                      }
                      s
                    </div>
                  </div>

                  {localResultSaved && (
                    <button
                      className="secondary"
                      onClick={
                        handleOpenBenchmarkResult
                      }
                      disabled={
                        openingLocalResult
                      }
                      style={{
                        whiteSpace:
                          "nowrap",
                        minHeight:
                          "31px",
                      }}
                    >
                      {openingLocalResult
                        ? "Opening..."
                        : "View Result"}
                    </button>
                  )}
                </div>
              </div>

              {localResultSaved && (
                <div
                  style={{
                    display:
                      "flex",
                    alignItems:
                      "center",
                    justifyContent:
                      "space-between",
                    gap: "10px",
                    background:
                      "#13251b",
                    border:
                      "1px solid #245237",
                    borderRadius:
                      "7px",
                    padding:
                      "9px 10px",
                    marginBottom:
                      "12px",
                    fontSize:
                      "12px",
                  }}
                >
                  <span
                    style={{
                      color:
                        "#8ee7aa",
                      fontWeight:
                        600,
                    }}
                  >
                    ✓ Local result saved
                  </span>

                  <span
                    style={{
                      color:
                        "#6f9b7b",
                      fontSize:
                        "10px",
                    }}
                  >
                    benchmark-result.json
                  </span>
                </div>
              )}

              {localResultError && (
                <div
                  style={{
                    marginBottom:
                      "12px",
                    background:
                      "#301b1b",
                    border:
                      "1px solid #4a2929",
                    borderRadius:
                      "7px",
                    padding:
                      "9px 10px",
                    color:
                      "#ffb0b0",
                    fontSize:
                      "11px",
                  }}
                >
                  <strong>
                    Could not open local result:
                  </strong>{" "}
                  {localResultError}
                </div>
              )}

              <div
                style={{
                  display:
                    "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: "10px",
                }}
              >
                <div
                  style={{
                    background:
                      "#101114",
                    borderRadius:
                      "7px",
                    padding:
                      "10px",
                  }}
                >
                  <span className="stat-label">
                    Per Thread
                  </span>

                  <span className="stat-value">
                    {formatHashrate(
                      benchmarkResult
                        .benchmark
                        .per_thread_hps
                    )}
                  </span>
                </div>

                <div
                  style={{
                    background:
                      "#101114",
                    borderRadius:
                      "7px",
                    padding:
                      "10px",
                  }}
                >
                  <span className="stat-label">
                    CPU
                  </span>

                  <span
                    className="stat-value"
                    style={{
                      fontSize:
                        "13px",
                      wordBreak:
                        "break-word",
                    }}
                  >
                    {
                      benchmarkResult
                        .benchmark
                        .cpu
                    }
                  </span>
                </div>

                <div
                  style={{
                    background:
                      "#101114",
                    borderRadius:
                      "7px",
                    padding:
                      "10px",
                  }}
                >
                  <span className="stat-label">
                    Architecture
                  </span>

                  <span className="stat-value">
                    {
                      benchmarkResult
                        .benchmark
                        .architecture
                    }
                  </span>
                </div>

                <div
                  style={{
                    background:
                      "#101114",
                    borderRadius:
                      "7px",
                    padding:
                      "10px",
                  }}
                >
                  <span className="stat-label">
                    Operating System
                  </span>

                  <span className="stat-value">
                    {
                      benchmarkResult
                        .benchmark
                        .os
                    }
                  </span>
                </div>
              </div>

              <div
                style={{
                  marginTop:
                    "10px",
                  fontSize:
                    "10px",
                  color:
                    "#666",
                }}
              >
                Completed{" "}
                {new Date(
                  benchmarkResult
                    .benchmark
                    .timestamp
                ).toLocaleString()}
                {" · "}
                Sugarmaker{" "}
                {
                  benchmarkResult
                    .benchmark
                    .sugarmaker_version
                }
              </div>

              {/* -------------------------------------------------
                  COMMUNITY COMPARISON
                 ------------------------------------------------- */}
              <div
                style={{
                  marginTop:
                    "18px",
                  borderTop:
                    "1px solid #2a2b30",
                  paddingTop:
                    "16px",
                }}
              >
                <div
                  style={{
                    display:
                      "flex",
                    justifyContent:
                      "space-between",
                    alignItems:
                      "center",
                    gap:
                      "12px",
                    marginBottom:
                      "12px",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize:
                          "15px",
                        fontWeight:
                          600,
                      }}
                    >
                      Community Comparison
                    </div>

                    <div
                      className="subtle"
                      style={{
                        marginTop:
                          "3px",
                      }}
                    >
                      Compare your result against
                      community benchmark results
                      for{" "}
                      {
                        benchmarkAlgorithm
                      }.
                    </div>
                  </div>

                  <button
                    className="secondary"
                    onClick={
                      loadCommunityBenchmarks
                    }
                    disabled={
                      communityLoading
                    }
                    style={{
                      whiteSpace:
                        "nowrap",
                    }}
                  >
                    {communityLoading
                      ? "Refreshing..."
                      : "Refresh Community Results"}
                  </button>
                </div>

                {communityError && (
                  <div
                    style={{
                      background:
                        "#301b1b",
                      border:
                        "1px solid #4a2929",
                      borderRadius:
                        "7px",
                      padding:
                        "10px",
                      color:
                        "#ffb0b0",
                      fontSize:
                        "12px",
                      marginBottom:
                        "12px",
                    }}
                  >
                    <strong>
                      Could not load community
                      benchmarks:
                    </strong>{" "}
                    {communityError}
                  </div>
                )}

                {!communityLoading &&
                  !communityError &&
                  filteredCommunityBenchmarks.length ===
                    0 && (
                    <div
                      style={{
                        background:
                          "#101114",
                        borderRadius:
                          "7px",
                        padding:
                          "12px",
                        color:
                          "#888",
                        fontSize:
                          "12px",
                      }}
                    >
                      No community benchmark
                      results are currently
                      available for{" "}
                      {
                        benchmarkAlgorithm
                      }.
                    </div>
                  )}

                {filteredCommunityBenchmarks.length >
                  0 && (
                  <>
                    <div
                      style={{
                        display:
                          "grid",
                        gridTemplateColumns:
                          "minmax(200px, 1fr) auto",
                        gap:
                          "10px",
                        alignItems:
                          "end",
                        marginBottom:
                          "12px",
                      }}
                    >
                      <label
                        style={{
                          display:
                            "flex",
                          flexDirection:
                            "column",
                          gap:
                            "5px",
                          fontSize:
                            "12px",
                          color:
                            "#aaa",
                        }}
                      >
                        Compare against CPU

                        <select
                          value={
                            selectedCommunityCpu
                          }
                          onChange={(
                            event
                          ) =>
                            setSelectedCommunityCpu(
                              event
                                .target
                                .value
                            )
                          }
                          style={{
                            background:
                              "#101114",
                            border:
                              "1px solid #333",
                            color:
                              "#e6e6e6",
                            padding:
                              "7px 8px",
                            borderRadius:
                              "6px",
                            fontSize:
                              "12px",
                          }}
                        >
                          {communityCpuOptions.map(
                            (cpu) => (
                              <option
                                key={
                                  cpu
                                }
                                value={
                                  cpu
                                }
                              >
                                {
                                  cpu
                                }
                              </option>
                            )
                          )}
                        </select>
                      </label>

                      <div
                        style={{
                          fontSize:
                            "11px",
                          color:
                            "#777",
                          paddingBottom:
                            "8px",
                          whiteSpace:
                            "nowrap",
                        }}
                      >
                        {
                          filteredCommunityBenchmarks.length
                        }{" "}
                        community{" "}
                        {filteredCommunityBenchmarks.length ===
                        1
                          ? "result"
                          : "results"}
                      </div>
                    </div>

                    {selectedCommunityBenchmark && (
                      <>
                        <div
                          style={{
                            display:
                              "grid",
                            gridTemplateColumns:
                              "repeat(auto-fit, minmax(150px, 1fr))",
                            gap:
                              "10px",
                          }}
                        >
                          <div
                            style={{
                              background:
                                "#101114",
                              borderRadius:
                                "7px",
                              padding:
                                "10px",
                            }}
                          >
                            <span className="stat-label">
                              Community Hashrate
                            </span>

                            <span className="stat-value">
                              {formatHashrate(
                                selectedCommunityBenchmark
                                  .hashrate_hps
                              )}
                            </span>
                          </div>

                          <div
                            style={{
                              background:
                                "#101114",
                              borderRadius:
                                "7px",
                              padding:
                                "10px",
                            }}
                          >
                            <span className="stat-label">
                              Community Per Thread
                            </span>

                            <span className="stat-value">
                              {formatHashrate(
                                selectedCommunityBenchmark
                                  .per_thread_hps
                              )}
                            </span>
                          </div>

                          <div
                            style={{
                              background:
                                "#101114",
                              borderRadius:
                                "7px",
                              padding:
                                "10px",
                            }}
                          >
                            <span className="stat-label">
                              Threads
                            </span>

                            <span className="stat-value">
                              {
                                selectedCommunityBenchmark
                                  .threads
                              }
                            </span>
                          </div>

                          <div
                            style={{
                              background:
                                "#101114",
                              borderRadius:
                                "7px",
                              padding:
                                "10px",
                            }}
                          >
                            <span className="stat-label">
                              Platform
                            </span>

                            <span
                              className="stat-value"
                              style={{
                                fontSize:
                                  "13px",
                              }}
                            >
                              {
                                selectedCommunityBenchmark
                                  .os
                              }{" "}
                              /{" "}
                              {
                                selectedCommunityBenchmark
                                  .architecture
                              }
                            </span>
                          </div>
                        </div>

                        <div
                          style={{
                            display:
                              "grid",
                            gridTemplateColumns:
                              "repeat(auto-fit, minmax(180px, 1fr))",
                            gap:
                              "10px",
                            marginTop:
                              "10px",
                          }}
                        >
                          <div
                            style={{
                              background:
                                "#101114",
                              borderRadius:
                                "7px",
                              padding:
                                "10px",
                            }}
                          >
                            <span className="stat-label">
                              Your Per Thread
                            </span>

                            <span className="stat-value">
                              {formatHashrate(
                                benchmarkResult
                                  .benchmark
                                  .per_thread_hps
                              )}
                            </span>
                          </div>

                          <div
                            style={{
                              background:
                                "#101114",
                              borderRadius:
                                "7px",
                              padding:
                                "10px",
                            }}
                          >
                            <span className="stat-label">
                              Per-Thread Difference
                            </span>

                            <span
                              className="stat-value"
                              style={{
                                fontSize:
                                  "17px",
                              }}
                            >
                              {perThreadDifference ===
                              null
                                ? "N/A"
                                : `${
                                    perThreadDifference >=
                                    0
                                      ? "+"
                                      : ""
                                  }${perThreadDifference.toFixed(
                                    2
                                  )}%`}
                            </span>
                          </div>

                          <div
                            style={{
                              background:
                                "#101114",
                              borderRadius:
                                "7px",
                              padding:
                                "10px",
                            }}
                          >
                            <span className="stat-label">
                              Total Hashrate Difference
                            </span>

                            <span
                              className="stat-value"
                              style={{
                                fontSize:
                                  "17px",
                              }}
                            >
                              {totalDifference ===
                              null
                                ? "Different thread count"
                                : `${
                                    totalDifference >=
                                    0
                                      ? "+"
                                      : ""
                                  }${totalDifference.toFixed(
                                    2
                                  )}%`}
                            </span>
                          </div>
                        </div>

                        <div
                          style={{
                            marginTop:
                              "10px",
                            padding:
                              "9px 10px",
                            background:
                              "#101114",
                            borderRadius:
                              "7px",
                            fontSize:
                              "10px",
                            color:
                              "#666",
                          }}
                        >
                          Community result:
                          {" "}
                          {
                            selectedCommunityBenchmark
                              .cpu
                          }
                          {" · "}
                          {
                            selectedCommunityBenchmark
                              .duration_seconds
                          }
                          s benchmark
                          {" · "}
                          Sugarmaker{" "}
                          {
                            selectedCommunityBenchmark
                              .sugarmaker_version
                          }
                          {" · "}
                          {new Date(
                            selectedCommunityBenchmark
                              .timestamp
                          ).toLocaleString()}
                        </div>

                        {selectedCommunityBenchmark
                            .threads !==
                            benchmarkResult
                              .benchmark
                              .threads && (
                          <div
                            style={{
                              marginTop:
                                "8px",
                              fontSize:
                                "10px",
                              color:
                                "#777",
                            }}
                          >
                            The community result uses{" "}
                            {
                              selectedCommunityBenchmark
                                .threads
                            }{" "}
                            threads while your result
                            uses{" "}
                            {
                              benchmarkResult
                                .benchmark
                                .threads
                            }
                            . Per-thread hashrate is
                            therefore used for the
                            normalized comparison.
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
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
                `Worker ${
                  workers.length + 1
                }`
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
          onCancel={() =>
            setEditing(null)
          }
        />
      )}
    </div>
  );
}
