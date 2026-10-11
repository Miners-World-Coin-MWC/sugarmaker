# Sugarmaker on Android — Installation Guide

This guide explains how to install Termux on an Android phone or tablet, download Sugarmaker 2.5.2, and start CPU mining.

> **Important:** The download linked below is the **Android ARM64** build. Most modern 64-bit Android phones use ARM64, but check your device before continuing. This guide is for Android devices, not Windows, macOS, or desktop Linux.

## What you'll need

- An Android phone or tablet.
- An internet connection.
- A wallet address for the coin you intend to mine.
- A device compatible with the Android ARM64 build (`aarch64`).

## 1. Install Termux

1. Open the official [Termux page on F-Droid](https://f-droid.org/en/packages/com.termux/).
2. Follow the page's instructions to download and install Termux.
3. Open Termux and wait for its initial setup to finish.

Use a trusted source and avoid unofficial APK download sites. Do not mix Termux installations from different sources, as their app signatures may not match. If you already have Termux installed from another source, follow Termux's official guidance before changing sources.

## 2. Update Termux and install required tools

Open Termux and run:

```bash
pkg update && pkg upgrade -y
```

When the update finishes, install the download and extraction tools:

```bash
pkg install wget unzip file -y
```

## 3. Check your Android device's architecture

Run:

```bash
uname -m
```

Check the result:

- `aarch64` — 64-bit ARM; this is the expected architecture for the Android ARM64 build in this guide.
- `x86_64` — 64-bit Intel/AMD; the ARM64 binary will not run natively.
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

Find the miner executable with:

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
- `WORKER` — a worker name, for example `phone1`.
- `-t 2` — starts with two CPU threads. Adjust this to suit your device.

**Do not run the example command unchanged.** Replace the pool and wallet placeholders with real values. `YespowerMwc` is for MinersWorldCoin; if you are mining another coin, use that coin's supported algorithm and pool configuration.

## 8. Keep mining under control

- Press **Ctrl + C** in Termux to stop the miner. On a phone keyboard without a Ctrl key, Termux provides extra keys above the keyboard; you can also use a compatible external keyboard.
- Start with a low thread count and monitor the phone's temperature.
- Mining can use significant CPU power, generate heat, drain the battery quickly, and cause performance throttling.
- Avoid leaving the phone in direct sunlight or under bedding, and stop mining if it becomes excessively hot.
- Do not assume the phone will keep mining when Termux is in the background. Android battery management may pause or terminate it.
- Avoid mining while charging if the device becomes hot. Never leave a hot phone unattended.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| `pkg` cannot download packages | Check your internet connection and try `pkg update` again. |
| `unzip` cannot find the ZIP | Run `ls -la` and check that you are in the directory where the ZIP was downloaded. |
| `No such file or directory` | Run `find . -type f -name sugarmaker` to locate the executable. |
| `Permission denied` | Run `chmod +x` on the executable using its actual path. |
| `Exec format error` | Run `uname -m`. The Android ARM64 build requires compatible architecture. |
| Shares are rejected | Check the coin, algorithm, pool address, port, wallet address and worker format. |
| Mining stops in the background | Android may have restricted Termux's battery/background activity. Check your device's app battery settings, but be aware that settings vary by manufacturer and Android version. |
| Phone gets too hot | Stop the miner with **Ctrl + C**, let the device cool, and use fewer threads next time. |

## Getting help

If you need help, post the exact error message in the community Discord, along with the output of:

```bash
uname -m
```

Also include the command you ran, but **remove private information** before posting. Never share wallet seed phrases or private keys.

Happy mining! ⛏️
