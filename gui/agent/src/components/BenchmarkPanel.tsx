import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  BenchmarkEntry,
  BenchmarkFile,
  formatHashrate,
} from "../types";

interface BenchmarkPanelProps {
  cpu: string;
  architecture: string;
  os: string;
  logicalCores: number;
}

const ALGORITHMS = [
  "YespowerMwc",
  "YespowerAdvc",
] as const;

const DURATIONS = [
  { value: 15, label: "15 seconds" },
  { value: 30, label: "30 seconds" },
  { value: 60, label: "60 seconds" },
  { value: 120, label: "2 minutes" },
  { value: 300, label: "5 minutes" },
];

export default function BenchmarkPanel({
  cpu,
  architecture,
  os,
  logicalCores,
}: BenchmarkPanelProps) {
  const maxThreads =
    logicalCores > 0 ? logicalCores : 256;

  const [algorithm, setAlgorithm] =
    useState<string>("YespowerMwc");

  const [threads, setThreads] = useState(
    logicalCores > 0 ? logicalCores : 1
  );

  const [duration, setDuration] = useState(30);

  const [benchmarkFile, setBenchmarkFile] =
    useState<BenchmarkFile | null>(null);

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] =
    useState<BenchmarkEntry | null>(null);
  const [error, setError] = useState("");

  async function loadBenchmarks() {
    try {
      const data = await invoke<BenchmarkFile>(
        "load_benchmarks"
      );

      setBenchmarkFile(data);
      setError("");
    } catch (err) {
      console.error(
        "Failed to load benchmarks:",
        err
      );

      setError(String(err));
    }
  }

  useEffect(() => {
    loadBenchmarks();
  }, []);

  function handleThreadChange(
    value: string
  ) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      return;
    }

    const clamped = Math.max(
      1,
      Math.min(maxThreads, Math.floor(parsed))
    );

    setThreads(clamped);
  }

  async function runBenchmark() {
    if (running) {
      return;
    }

    setRunning(true);
    setResult(null);
    setError("");

    setStatus(
      `Benchmarking ${algorithm} using ${threads} thread${
        threads === 1 ? "" : "s"
      } for ${duration} seconds...`
    );

    try {
      const entry = await invoke<BenchmarkEntry>(
        "run_benchmark",
        {
          algorithm,
          threads,
          duration_seconds: duration,
        }
      );

      setResult(entry);

      const updated =
        await invoke<BenchmarkFile>(
          "load_benchmarks"
        );

      setBenchmarkFile(updated);

      setStatus(
        "Benchmark completed successfully."
      );
    } catch (err) {
      console.error(
        "Benchmark failed:",
        err
      );

      setError(String(err));
      setStatus("");
    } finally {
      setRunning(false);
    }
  }

  const algorithmResults = useMemo(() => {
    if (!benchmarkFile) {
      return [];
    }

    return benchmarkFile.benchmarks
      .filter(
        (entry) =>
          entry.algorithm === algorithm
      )
      .sort(
        (a, b) =>
          b.hashrate_hps -
          a.hashrate_hps
      );
  }, [benchmarkFile, algorithm]);

  return (
    <section className="benchmark-panel">
      <div className="benchmark-header">
        <div>
          <h2>CPU Benchmark</h2>

          <span className="subtle">
            Compare Yespower mining performance
            with the community.
          </span>
        </div>
      </div>

      <div className="benchmark-controls">
        <label>
          Algorithm

          <select
            value={algorithm}
            onChange={(e) =>
              setAlgorithm(e.target.value)
            }
            disabled={running}
          >
            {ALGORITHMS.map((algo) => (
              <option
                key={algo}
                value={algo}
              >
                {algo}
              </option>
            ))}
          </select>
        </label>

        <label>
          Threads

          <input
            type="number"
            min={1}
            max={maxThreads}
            step={1}
            value={threads}
            onChange={(e) =>
              handleThreadChange(
                e.target.value
              )
            }
            disabled={running}
          />
        </label>

        <label>
          Duration

          <select
            value={duration}
            onChange={(e) =>
              setDuration(
                Number(e.target.value)
              )
            }
            disabled={running}
          >
            {DURATIONS.map(
              ({ value, label }) => (
                <option
                  key={value}
                  value={value}
                >
                  {label}
                </option>
              )
            )}
          </select>
        </label>

        <button
          type="button"
          className="benchmark-start"
          onClick={runBenchmark}
          disabled={running}
        >
          {running
            ? "Benchmarking..."
            : "Start Benchmark"}
        </button>
      </div>

      {status && (
        <div className="benchmark-status">
          {status}
        </div>
      )}

      {error && (
        <div className="benchmark-error">
          {error}
        </div>
      )}

      {result && (
        <div className="benchmark-result">
          <div className="benchmark-result-title">
            Your Result
          </div>

          <div className="benchmark-result-grid">
            <div>
              <span className="stat-label">
                Algorithm
              </span>

              <span className="stat-value">
                {result.algorithm}
              </span>
            </div>

            <div>
              <span className="stat-label">
                Hashrate
              </span>

              <span className="stat-value">
                {formatHashrate(
                  result.hashrate_hps
                )}
              </span>
            </div>

            <div>
              <span className="stat-label">
                Threads
              </span>

              <span className="stat-value">
                {result.threads}
              </span>
            </div>

            <div>
              <span className="stat-label">
                Per Thread
              </span>

              <span className="stat-value">
                {formatHashrate(
                  result.per_thread_hps
                )}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="benchmark-community">
        <div className="benchmark-community-header">
          <div>
            <h3>
              Community Results —{" "}
              {algorithm}
            </h3>

            <span className="subtle">
              {algorithmResults.length}{" "}
              benchmark
              {algorithmResults.length === 1
                ? ""
                : "s"}
            </span>
          </div>
        </div>

        {algorithmResults.length === 0 ? (
          <div className="benchmark-empty">
            No community benchmarks have
            been recorded yet.
          </div>
        ) : (
          <div className="benchmark-table-wrapper">
            <table className="benchmark-table">
              <thead>
                <tr>
                  <th>CPU</th>
                  <th>OS</th>
                  <th>Threads</th>
                  <th>Hashrate</th>
                  <th>Per Thread</th>
                </tr>
              </thead>

              <tbody>
                {algorithmResults.map(
                  (entry, index) => (
                    <tr
                      key={`${entry.timestamp}-${index}`}
                    >
                      <td>
                        {entry.cpu}
                      </td>

                      <td>
                        {entry.os} /{" "}
                        {entry.architecture}
                      </td>

                      <td>
                        {entry.threads}
                      </td>

                      <td>
                        {formatHashrate(
                          entry.hashrate_hps
                        )}
                      </td>

                      <td>
                        {formatHashrate(
                          entry.per_thread_hps
                        )}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="benchmark-system-info">
        <span>
          <strong>CPU</strong>{" "}
          {cpu}
        </span>

        <span>
          <strong>
            Architecture
          </strong>{" "}
          {architecture}
        </span>

        <span>
          <strong>OS</strong>{" "}
          {os}
        </span>

        <span>
          <strong>
            Logical cores
          </strong>{" "}
          {logicalCores}
        </span>
      </div>
    </section>
  );
}
