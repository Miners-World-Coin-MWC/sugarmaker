import { WorkerConfig, WorkerStats, formatHashrate } from "../types";

interface Props {
  config: WorkerConfig;
  stats?: WorkerStats;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onEdit: (config: WorkerConfig) => void;
  onRemove: (id: string) => void;
}

export default function WorkerCard({ config, stats, onStart, onStop, onEdit, onRemove }: Props) {
  const running = stats?.running ?? false;

  return (
    <div className="worker-card">
      <div className="worker-card-header">
        <span className={`status-dot ${running ? "running" : "stopped"}`} />
        <strong>{config.label}</strong>
        <span className="threads">{config.threads} threads</span>
      </div>

      <div className="worker-card-stats">
        <div>
          <span className="stat-label">Hashrate</span>
          <span className="stat-value">{formatHashrate(stats?.total_hashrate_hps ?? 0)}</span>
        </div>
        <div>
          <span className="stat-label">Shares</span>
          <span className="stat-value">
            {stats?.accepted ?? 0} / {stats?.total_shares ?? 0}
          </span>
        </div>
        <div>
          <span className="stat-label">Rejected</span>
          <span className="stat-value">{stats?.rejected ?? 0}</span>
        </div>
        <div>
          <span className="stat-label">Restarts</span>
          <span className="stat-value">{stats?.restarts ?? 0}</span>
        </div>
      </div>

      <div className="worker-card-log">{stats?.last_line || "no output yet"}</div>

      <div className="worker-card-actions">
        {running ? (
          <button onClick={() => onStop(config.id)}>Stop</button>
        ) : (
          <button onClick={() => onStart(config.id)}>Start</button>
        )}
        <button onClick={() => onEdit(config)}>Edit</button>
        <button onClick={() => onRemove(config.id)} className="danger">
          Remove
        </button>
      </div>
    </div>
  );
}
