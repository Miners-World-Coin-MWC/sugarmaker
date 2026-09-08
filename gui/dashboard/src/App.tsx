import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import RigPanel from "./components/RigPanel";
import { RigEntry, RigConnectionState, formatHashrate } from "./types";

export default function App() {
  const [rigs, setRigs] = useState<RigEntry[]>([]);
  const [connections, setConnections] = useState<
    Record<string, RigConnectionState>
  >({});

  const [newLabel, setNewLabel] = useState("");
  const [newIp, setNewIp] = useState("");
  const [newPort, setNewPort] = useState("4780");

  async function refresh() {
    const [r, c] = await Promise.all([
      invoke<RigEntry[]>("list_rigs"),
      invoke<Record<string, RigConnectionState>>("get_connections"),
    ]);

    setRigs(r);
    setConnections(c);
  }

  useEffect(() => {
    refresh();

    const interval = setInterval(refresh, 1500);

    return () => clearInterval(interval);
  }, []);

  async function handleAddRig() {
    const label = newLabel.trim();
    const ip = newIp.trim();
    const port = newPort.trim();

    if (!label || !ip || !port) return;

    const address = `${ip}:${port}`;

    await invoke("add_rig", {
      label,
      address,
    });

    setNewLabel("");
    setNewIp("");
    setNewPort("4780");

    refresh();
  }

  async function handleRemoveRig(id: string) {
    await invoke("remove_rig", { id });
    refresh();
  }

  async function handleControl(
    rigId: string,
    workerId: string,
    action: "start" | "stop"
  ) {
    await invoke("control_remote_worker", {
      req: {
        rig_id: rigId,
        worker_id: workerId,
        action,
      },
    });
  }

  const fleetHashrate = Object.values(connections).reduce((sum, c) => {
    if (!c.last_snapshot) return sum;

    return (
      sum +
      Object.values(c.last_snapshot.stats).reduce(
        (s, w) => s + (w.total_hashrate_hps || 0),
        0
      )
    );
  }, 0);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Fleet dashboard</h1>
          <span className="subtle">
            {rigs.length} rig(s) configured
          </span>
        </div>

        <div className="total-hashrate">
          {formatHashrate(fleetHashrate)} across {rigs.length} rig(s)
        </div>
      </header>

      <div className="add-rig-row">
        <input
          placeholder="Rig label (e.g. Rack 1)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
        />

        <input
          placeholder="IP address (e.g. 192.168.1.42)"
          value={newIp}
          onChange={(e) => setNewIp(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleAddRig();
            }
          }}
        />

        <input
          type="number"
          min="1"
          max="65535"
          placeholder="Port"
          value={newPort}
          onChange={(e) => setNewPort(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleAddRig();
            }
          }}
        />

        <button onClick={handleAddRig}>+ Add rig</button>
      </div>

      <div className="rig-grid">
        {rigs.map((rig) => (
          <RigPanel
            key={rig.id}
            rig={rig}
            connection={connections[rig.id]}
            onRemove={handleRemoveRig}
            onControl={handleControl}
          />
        ))}
      </div>
    </div>
  );
}
