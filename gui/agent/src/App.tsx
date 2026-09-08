import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import WorkerCard from "./components/WorkerCard";
import ConfigEditor from "./components/ConfigEditor";
import BenchmarkPanel from "./components/BenchmarkPanel";

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

export default function App() {
  const [workers, setWorkers] = useState<WorkerConfig[]>([]);
  const [stats, setStats] =
    useState<Record<string, WorkerStats>>({});
  const [rig, setRig] = useState<RigInfo | null>(null);

  const [connection, setConnection] =
    useState<DashboardConnection | null>(null);

  const [editing, setEditing] =
    useState<WorkerConfig | null>(null);

  async function refresh() {
    try {
      const [w, s] = await Promise.all([
        invoke<WorkerConfig[]>("list_workers"),
        invoke<Record<string, WorkerStats>>("get_stats"),
      ]);

      setWorkers(w);
      setStats(s);
    } catch (error) {
      console.error("Failed to refresh workers:", error);
    }
  }

  async function loadRigInfo() {
    try {
      const info = await invoke<RigInfo>("get_rig_info");
      setRig(info);
    } catch (error) {
      console.error("Failed to get rig information:", error);
    }
  }

  async function loadConnectionInfo() {
    try {
      const info = await invoke<DashboardConnection>(
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

  useEffect(() => {
    refresh();
    loadRigInfo();
    loadConnectionInfo();

    const interval = setInterval(refresh, 1500);

    return () => clearInterval(interval);
  }, []);

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

  const totalHashrate = Object.values(stats).reduce(
    (sum, s) =>
      sum + (s.total_hashrate_hps || 0),
    0
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

      <main>
        <section className="workers-section">
          <div className="section-header">
            <div>
              <h2>Workers</h2>

              <span className="subtle">
                Manage your Sugarmaker mining workers.
              </span>
            </div>
          </div>

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
        </section>

        {rig && (
          <BenchmarkPanel
            cpu={rig.cpu_brand}
            architecture={rig.arch}
            os={rig.os}
            logicalCores={rig.logical_cores}
          />
        )}
      </main>

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
