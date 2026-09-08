import { useEffect, useState } from "react";
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

export default function App() {
  const [workers, setWorkers] = useState<WorkerConfig[]>([]);
  const [stats, setStats] = useState<Record<string, WorkerStats>>({});
  const [rig, setRig] = useState<RigInfo | null>(null);
  const [connection, setConnection] =
    useState<DashboardConnection | null>(null);
  const [editing, setEditing] = useState<WorkerConfig | null>(null);

  async function refresh() {
    const [w, s] = await Promise.all([
      invoke<WorkerConfig[]>("list_workers"),
      invoke<Record<string, WorkerStats>>("get_stats"),
    ]);

    setWorkers(w);
    setStats(s);
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
    invoke<RigInfo>("get_rig_info").then(setRig);
    loadConnectionInfo();

    const interval = setInterval(refresh, 1500);

    return () => clearInterval(interval);
  }, []);

  async function handleStart(id: string) {
    await invoke("start_worker", { id });
    refresh();
  }

  async function handleStop(id: string) {
    await invoke("stop_worker", { id });
    refresh();
  }

  async function handleSave(config: WorkerConfig) {
    await invoke("upsert_worker", { config });
    setEditing(null);
    refresh();
  }

  async function handleRemove(id: string) {
    await invoke("remove_worker", { id });
    refresh();
  }

  const totalHashrate = Object.values(stats).reduce(
    (sum, s) => sum + (s.total_hashrate_hps || 0),
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
            setEditing(emptyWorker(`Worker ${workers.length + 1}`))
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
