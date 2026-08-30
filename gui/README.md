# sugarmaker GUI layer

This folder is meant to live inside the `sugarmaker` repo itself, on the
`GUI-Layer` branch, alongside the existing C miner source.

```
sugarmaker/                  <- repo root (existing C source, unchanged)
├── cpu-miner.c, ...          <- existing files, untouched
├── gui/
│   ├── agent/                 <- per-rig app: runs & supervises sugarmaker
│   └── dashboard/              <- multi-rig fleet view
└── .github/workflows/
    └── gui-build.yml         <- new workflow, builds C binary + wraps it in the GUI
```

## How to add this to your fork

From a clone of your fork on the `GUI-Layer` branch:

```bash
git checkout GUI-Layer

# copy this gui/ folder and workflow file into the repo root, then:
git add gui/ .github/workflows/gui-build.yml
git commit -m "Add GUI layer (agent + fleet dashboard)"
git push origin GUI-Layer
```

That's it structurally -- nothing in the existing C build (`autogen.sh`,
`configure`, `make`) is touched. The GUI is purely additive.

## How the two fit together

- **`agent`** is a Tauri desktop app that runs on each mining rig. It spawns
  and supervises one or more `sugarmaker` processes (one per "worker"),
  parses their stdout for live hashrate/shares, and shows a UI with a config
  editor per worker. It also opens a WebSocket on port 4780 so a remote
  dashboard can watch/control it.
- **`dashboard`** connects to as many agents as you point it at and shows an
  aggregated, multi-rig view.
- The CI workflow (`build-native` job) builds the real `sugarmaker` binary
  using the exact `autogen.sh` / `configure` / `make` steps from the repo's
  own README, then copies it into `gui/agent/src-tauri/binaries/` before
  packaging the agent -- so the shipped agent app is self-contained and
  doesn't need `sugarmaker` installed separately or on `PATH`.

This covers 6 of your 11 target platforms directly (x86_64/i686 Linux,
x86_64 Windows, x86_64/arm64 macOS) since those can build the C miner
natively on GitHub-hosted runners. The remaining 4
(aarch64/armv7l/riscv64 Linux, arm64 Windows) need a cross-compiled C
binary, and the `build-cross` job is left as a clearly-marked placeholder --
see the note below.

## Before this actually builds anything

**Verify the log parser.** `gui/agent/src-tauri/src/parser.rs` assumes the
classic pooler/cpuminer log format (`thread N: X hashes, Y kH/s` /
`accepted: X/Y (%), Y kH/s`). Run the real binary from a terminal and check;
if it differs, only the three regexes at the top of that file need updating.

**Wire up the cross-compiled targets.** `build-cross` in the workflow
currently fails on purpose with a TODO, because cross-compiling the C miner
for aarch64/armv7l/riscv64 Linux and arm64 Windows needs a matching cross
gcc + cross-built `libcurl` for each, and I don't know how you're currently
producing those 4 binaries (a separate release workflow? a Docker
cross-build image? manually?). Point that step at whatever already produces
them -- e.g. `actions/download-artifact` from an existing release job, or a
`cross`/Docker-based cross-compile -- and the rest of the job (copying the
binary in, building the GUI) is already wired up to use it.

**App icons.** `tauri.conf.json` in both `agent/` and `dashboard/` reference
an `icons/` folder that doesn't exist yet. Run `npx tauri icon <path-to-png>`
in each to generate one, or the bundle step will fail.

**WebSocket auth.** The agent's port-4780 WebSocket has no authentication --
fine on a private LAN/VPN/tailnet between your own rigs, not fine exposed to
the open internet.

## Local dev (no bundled binary needed)

```bash
cd gui/agent && npm install && npm run tauri dev
```

In dev mode there's nothing in `binaries/` yet, so set an explicit binary
path in the config editor pointing at a `sugarmaker` you built locally with
the normal `./autogen.sh && ./configure && make` from the repo root.
