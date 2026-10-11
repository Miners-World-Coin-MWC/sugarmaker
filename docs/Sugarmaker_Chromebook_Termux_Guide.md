# Sugarmaker on a Chromebook — Installation Guide

This guide explains how to install Termux on a compatible Chromebook, download Sugarmaker 2.5.2, and start the miner.

> **Important:** The download linked below is the **Android ARM64** build. It is intended for compatible 64-bit ARM devices. It will not run natively on most Intel/AMD (`x86_64`) Chromebooks. Check your architecture before continuing.

## What you'll need

- A Chromebook that supports Android apps and can install Termux.
- An internet connection.
- A wallet address for the coin you intend to mine.
- A compatible ARM64 Chromebook (`aarch64`).

## 1. Install Termux

1. Open the official [Termux page on F-Droid](https://f-droid.org/en/packages/com.termux/).
2. Follow the page's instructions to download and install Termux.
3. Open Termux and wait for its initial setup to finish.

Use a trusted source and avoid unofficial APK download sites. Avoid mixing Termux installations from different sources, as their app signatures may not match.

**If your Chromebook cannot install Android apps, this Termux method may not work.** ChromeOS's built-in Linux development environment is different from Termux.

## 2. Update Termux and install required tools

Open Termux and run:

```bash
pkg update && pkg upgrade -y
```

When the update finishes, install the download and extraction tools:

```bash
pkg install wget unzip file -y
```

## 3. Check your Chromebook's architecture

Run:

```bash
uname -m
```

Check the result:

- `aarch64` — 64-bit ARM; this is the expected architecture for the Android ARM64 build in this guide.
- `x86_64` — Intel/AMD 64-bit; the ARM64 binary will not run natively.
- `armv7l` — 32-bit ARM; this is not the correct build for this guide.

**Continue only if the result is `aarch64`.**

## 4. Download Sugarmaker 2.5.2

Run these commands:

```bash
cd ~
wget https://github.com/Miners-World-Coin-MWC/sugarmaker/releases/download/2.5.2/sugarmaker-android-arm64.zip
```

This downloads the release ZIP from the Miners World Coin Sugarmaker GitHub repository.

## 5. Extract the ZIP

Run:

```bash
unzip sugarmaker-android-arm64.zip
ls -la
```

Look at the files and folders that were extracted. Find the miner executable with:

```bash
find . -type f -name sugarmaker
```

If the command returns `./sugarmaker`, continue in the current directory. If it returns a path inside a subfolder, change into that folder or use the returned path in the commands below.

Make the executable runnable (use the correct path if it is inside a subfolder):

```bash
chmod +x ./sugarmaker
```

## 6. Test the miner

Run:

```bash
./sugarmaker --help
```

If a help/options list appears, the executable starts successfully.

If the binary is in a subfolder, use its actual path instead of `./sugarmaker`.

## 7. Start mining

You'll need a compatible pool address and port, a wallet address, and the correct algorithm for the coin you intend to mine.

The general command format for MinersWorldCoin is:

```bash
./sugarmaker -a YespowerMwc -o stratum+tcp://POOL_ADDRESS:PORT -u YOUR_WALLET_ADDRESS.WORKER -p x -t 2
```

Replace these example values before running the command:

- `POOL_ADDRESS:PORT` — the actual address and port of your chosen compatible pool.
- `YOUR_WALLET_ADDRESS` — your wallet address for the coin you're mining.
- `WORKER` — a worker name, for example `chromebook1`.
- `-t 2` — starts with two CPU threads. Adjust this to suit your device.

**Do not run the example command unchanged.** Replace the pool and wallet placeholders with real values. `YespowerMwc` is for MinersWorldCoin; if you are mining another coin, use that coin's supported algorithm and pool configuration.

## 8. Stop mining and use your Chromebook safely

- Press **Ctrl + C** in the terminal to stop the miner.
- Start with a low thread count and monitor the device's temperature.
- Keep the Chromebook on a hard, ventilated surface.
- Stop mining if the device becomes excessively hot or unstable.
- Expect increased power use and reduced battery life.
- Keep Termux open while testing. Android or ChromeOS may stop resource-intensive background processes.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| `pkg` cannot download packages | Check your internet connection and try `pkg update` again. |
| `unzip` cannot find the ZIP | Run `ls -la` and check that you are in the directory where the ZIP was downloaded. |
| `No such file or directory` | Run `find . -type f -name sugarmaker` to locate the executable. |
| `Permission denied` | Run `chmod +x` on the executable using its actual path. |
| `Exec format error` | Run `uname -m`. The Android ARM64 build requires compatible architecture. |
| Shares are rejected | Check the coin, algorithm, pool address, port, wallet address and worker format. |
| Mining stops unexpectedly | Check temperature, power settings, and whether Android or ChromeOS stopped Termux. |

## Getting help

If you need help, post the exact error message in the community Discord, along with the output of:

```bash
uname -m
```

Also include the command you ran, but **remove private information** before posting. Never share wallet seed phrases or private keys.

Happy mining! ⛏️
