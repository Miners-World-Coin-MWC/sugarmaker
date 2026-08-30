import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import WorkerCard from "./components/WorkerCard";
import ConfigEditor from "./components/ConfigEditor";
import { WorkerConfig, WorkerStats, RigInfo, emptyWorker } from "./types";

export default function App() {
  const [workers, setWorkers] = useState<WorkerConfig[]>([]);
  const [stats, setStats] = useState<Record<string, WorkerStats>>({});
  const [rig, setRig] = useState<RigInfo | null>(null);
  const [editing, setEditing] = useState<WorkerConfig | null>(null);

  async function refresh() {
    const [w, s] = await Promise.all([
      invoke<WorkerConfig[]>("list_workers"),
      invoke<Record<string, WorkerStats>>("get_stats"),
    ]);
    setWorkers(w);
    setStats(s);
  }

  useEffect(() => {
    refresh();
    invoke<RigInfo>("get_rig_info").then(setRig);
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
            {rig ? `${rig.cpu_brand} · ${rig.logical_cores} threads · ${rig.os}/${rig.arch}` : ""}
          </span>
        </div>
        <div className="total-hashrate">{(totalHashrate / 1000).toFixed(2)} kH/s total</div>
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
        <button className="add-worker" onClick={() => setEditing(emptyWorker(`Worker ${workers.length + 1}`))}>
          + Add worker
        </button>
      </div>

      {editing && (
        <ConfigEditor initial={editing} onSave={handleSave} onCancel={() => setEditing(null)} />
      )}
    </div>
  );
}
