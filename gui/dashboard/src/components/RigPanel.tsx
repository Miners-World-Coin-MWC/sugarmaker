import { RigEntry, RigConnectionState, formatHashrate } from "../types";

interface Props {
  rig: RigEntry;
  connection?: RigConnectionState;
  onRemove: (id: string) => void;
  onControl: (rigId: string, workerId: string, action: "start" | "stop") => void;
}

export default function RigPanel({ rig, connection, onRemove, onControl }: Props) {
  const snapshot = connection?.last_snapshot;
  const totalHashrate = snapshot
    ? Object.values(snapshot.stats).reduce((sum, s) => sum + (s.total_hashrate_hps || 0), 0)
    : 0;

  return (
    <div className="rig-panel">
      <div className="rig-panel-header">
        <span className={`status-dot ${connection?.connected ? "running" : "stopped"}`} />
        <strong>{rig.label}</strong>
        <span className="subtle">{rig.address}</span>
        <button className="danger small" onClick={() => onRemove(rig.id)}>
          Remove
        </button>
      </div>

      {!connection?.connected && (
        <div className="rig-error">
          {connection?.last_error ? `Disconnected: ${connection.last_error}` : "Connecting..."}
        </div>
      )}

      {snapshot && (
        <>
          <div className="rig-meta">
            {snapshot.rig.cpu_brand} · {snapshot.rig.logical_cores} threads ·{" "}
            {snapshot.rig.cpu_usage_percent.toFixed(0)}% CPU · {snapshot.rig.os}/{snapshot.rig.arch}
          </div>
          <div className="rig-total">{formatHashrate(totalHashrate)} total</div>

          <table className="worker-table">
            <thead>
              <tr>
                <th>Worker</th>
                <th>Hashrate</th>
                <th>Shares</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {snapshot.workers.map((w) => {
                const s = snapshot.stats[w.id];
                return (
                  <tr key={w.id}>
                    <td>{w.label}</td>
                    <td>{formatHashrate(s?.total_hashrate_hps ?? 0)}</td>
                    <td>
                      {s?.accepted ?? 0}/{s?.total_shares ?? 0}
                    </td>
                    <td>
                      {s?.running ? (
                        <button className="small" onClick={() => onControl(rig.id, w.id, "stop")}>
                          Stop
                        </button>
                      ) : (
                        <button className="small" onClick={() => onControl(rig.id, w.id, "start")}>
                          Start
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
