import { useState } from "react";
import { WorkerConfig } from "../types";

interface Props {
  initial: WorkerConfig;
  onSave: (config: WorkerConfig) => void;
  onCancel: () => void;
}

export default function ConfigEditor({ initial, onSave, onCancel }: Props) {
  const [form, setForm] = useState<WorkerConfig>(initial);

  function set<K extends keyof WorkerConfig>(key: K, value: WorkerConfig[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>{initial.label ? "Edit worker" : "New worker"}</h3>

        <label>
          Label
          <input
            value={form.label}
            onChange={(e) => set("label", e.target.value)}
          />
        </label>

        <label>
          Algorithm
          <select
            value={form.algo}
            onChange={(e) => set("algo", e.target.value)}
          >
            <option value="YespowerMwc">YespowerMwc</option>
          </select>
        </label>

        <label>
          Pool URL
          <input
            value={form.pool_url}
            onChange={(e) => set("pool_url", e.target.value)}
            placeholder="stratum+tcp://bmine.net:3033"
          />
        </label>

        <label>
          Username / wallet address
          <input
            value={form.username}
            onChange={(e) => set("username", e.target.value)}
          />
        </label>

        <label>
          Password
          <input
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
          />
        </label>

        <label>
          Coinbase address (solo mining only, leave blank for pool)
          <input
            value={form.coinbase_addr ?? ""}
            onChange={(e) =>
              set("coinbase_addr", e.target.value || null)
            }
          />
        </label>

        <label>
          Threads
          <input
            type="number"
            min={1}
            value={form.threads}
            onChange={(e) =>
              set("threads", parseInt(e.target.value, 10) || 1)
            }
          />
        </label>

        <label>
          Binary path (blank = use the sugarmaker build bundled with this app)
          <input
            value={form.binary_path ?? ""}
            onChange={(e) =>
              set("binary_path", e.target.value || null)
            }
          />
        </label>

        <label>
          Extra CLI args (space separated)
          <input
            value={form.extra_args.join(" ")}
            onChange={(e) =>
              set(
                "extra_args",
                e.target.value.split(" ").filter(Boolean)
              )
            }
          />
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.autostart}
            onChange={(e) => set("autostart", e.target.checked)}
          />
          Autostart with the agent
        </label>

        <div className="modal-actions">
          <button onClick={() => onSave(form)}>Save</button>
          <button onClick={onCancel} className="secondary">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
