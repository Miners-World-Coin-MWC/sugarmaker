# SUGARMAKER

![GitHub All Releases](https://img.shields.io/github/downloads/Miners-World-Coin-MWC/sugarmaker/total)

**Sugarmaker** is a multi-threaded CPU miner derived from the original Sugarchain `cpuminer` project and its upstream lineage through Resistance, Pooler, and the Bitcoin reference miner.

This fork focuses on **YesPower-family CPU mining** and has been extended with additional algorithms, optimized builds, cross-platform tooling, a graphical mining manager, and an integrated CPU benchmark system.

Built with a focus on **CPU mining, accessibility, performance, and community-driven benchmarking**.

---

## ⚡ Features

* Multi-threaded CPU mining
* YesPower-family algorithms
* **YespowerMwc** support for Miners World Coin (MWC)
* **YespowerAdvc** support
* Cross-platform builds
* Native CPU architecture builds
* Windows GUI / Sugarmaker Agent
* Worker configuration and management
* Start / stop / edit / remove workers
* Live hashrate and share statistics
* CPU information and system detection
* Built-in CPU benchmarking
* Local benchmark result saving
* Community benchmark comparison
* Per-thread and total hashrate comparison
* Benchmark results stored in `benchmark-result.json`

---

# 🧱 Build Targets

Sugarmaker is built for a wide range of operating systems and CPU architectures.

| Platform | Architecture | Typical Devices / Systems              |
| -------- | ------------ | -------------------------------------- |
| Linux    | x86_64       | Modern Intel / AMD PCs and servers     |
| Linux    | i686         | 32-bit x86 systems                     |
| Linux    | ARMv7        | Raspberry Pi and ARM SBCs              |
| Linux    | AArch64      | Raspberry Pi 4/5, ARM servers and SBCs |
| Linux    | RISC-V 64    | RISC-V development boards and systems  |
| macOS    | x86_64       | Intel Macs                             |
| macOS    | ARM64        | Apple Silicon Macs                     |
| Windows  | x86_64       | Modern Windows PCs                     |
| Windows  | ARM64        | Windows ARM systems                    |

Build availability may vary between releases.

---

# 🖥️ Sugarmaker GUI / Agent

Sugarmaker includes a cross-platform graphical management interface designed to make CPU mining easier to configure and monitor.

The GUI allows users to:

* Add and remove mining workers
* Edit worker configurations
* Select the mining algorithm
* Configure pool URLs
* Configure wallet / worker usernames
* Configure passwords
* Configure thread counts
* Start and stop workers
* Monitor hashrate
* Monitor accepted and rejected shares
* Monitor restarts
* View system information
* Run CPU benchmarks

A worker can be configured to generate commands such as:

```text
sugarmaker --a YespowerMwc --url <pool> --threads <threads> --user <wallet.worker> --pass <password>
```

For example:

```text
sugarmaker --a YespowerMwc --url stratum+tcp://bmine.net:3033 --threads 2 --user <wallet.worker> --pass <password>
```

---

# 📊 CPU Benchmark System

Sugarmaker includes a built-in CPU benchmark system for testing supported YesPower algorithms.

Currently supported benchmark algorithms include:

```text
YespowerMwc
YespowerAdvc
```

Users can select:

* Algorithm
* Number of CPU threads
* Benchmark duration

The benchmark records information including:

* CPU model
* Architecture
* Operating system
* Thread count
* Total hashrate
* Per-thread hashrate
* Benchmark duration
* Sugarmaker version
* Timestamp

Successful benchmark results are saved locally as:

```text
benchmark-result.json
```

The GUI also provides a **Community Comparison** system, allowing users to compare their local benchmark against benchmark results collected by the MWC community.

The comparison can show:

* Community hashrate
* Community per-thread hashrate
* Thread count
* Operating system
* CPU architecture
* Per-thread difference
* Total hashrate difference when thread counts match

Community benchmark data is read from the project's benchmark repository.

---

# 🪙 Miners World Coin (MWC)

Sugarmaker includes native support for the **Miners World Coin (MWC)** YesPower implementation:

```text
YespowerMwc
```

MWC uses a CPU-focused YesPower variant designed around accessible CPU mining.

Example MWC pool configuration:

```text
./sugarmaker --a YespowerMwc \
  --url stratum+tcp://bmine.net:3033 \
  --threads 2 \
  --user <wallet.worker> \
  --pass <password>
```

On Windows, omit the leading `./`.

---

# 🔧 Build Dependencies

The basic build requires:

```text
autoconf
automake
GNU make
gcc
libcurl
```

For recent Debian and Ubuntu systems:

```bash
sudo apt-get update
sudo apt-get install build-essential libcurl4-openssl-dev autotools-dev automake libtool
```

---

# 🐧 Basic Unix Build

Clone the repository and build:

```bash
./autogen.sh
./configure CFLAGS="-Wall -O2 -fomit-frame-pointer" CXXFLAGS="$CFLAGS -std=gnu++11"
make
```

The resulting miner can then be run with:

```bash
./sugarmaker --help
```

---

# 🪟 Basic Windows Build Using MinGW

Install MinGW and the MSYS Developer Tool Kit.

If using MinGW-w64, install:

```text
pthreads-w64
```

Install the appropriate `libcurl` development package and ensure the required files are available.

From the MSYS shell:

```bash
./autogen.sh
LIBCURL='-lcurldll' ./configure
make
```

---

# ⛏️ Usage

Run:

```bash
./sugarmaker --help
```

to display all available command-line options.

## MWC Stratum Mining

```bash
./sugarmaker --a YespowerMwc \
  --url stratum+tcp://bmine.net:3033 \
  --threads 1 \
  --user <wallet.worker> \
  --pass <password>
```

Increase `--threads` to use additional CPU threads:

```bash
./sugarmaker --a YespowerMwc \
  --url stratum+tcp://bmine.net:3033 \
  --threads 4 \
  --user <wallet.worker> \
  --pass <password>
```

---

# 🧪 Testnet / Solo Mining

Solo mining requires a fully synchronized node running locally with RPC credentials configured.

The appropriate RPC URL, credentials, coinbase address, and algorithm should be supplied according to the target network.

Run:

```bash
./sugarmaker --help
```

for the available mining and RPC options.

---

# 🌐 Proxy Support

Sugarmaker supports proxy connections through the `--proxy` option.

SOCKS proxies can be specified using:

```text
socks4://
socks5://
```

Remote DNS resolution is also supported through:

```text
socks4a://
socks5h://
```

If no protocol is specified, the proxy is treated as an HTTP proxy.

When `--proxy` is not specified, Sugarmaker also honours the following environment variables:

```text
http_proxy
all_proxy
```

---

# 🖥️ Benchmarking From the Command Line

The benchmark functionality can also be used independently of the GUI where supported by the build.

The GUI provides an easier way to select the algorithm, thread count and duration, then displays the resulting CPU performance.

Benchmark results are intended to help users:

* Test their own hardware
* Compare different CPUs
* Compare different operating systems
* Compare different architectures
* Evaluate mining optimizations
* Contribute benchmark results to the MWC community

---

# 📁 Benchmark Results

Local benchmark results are written to:

```text
benchmark-result.json
```

The result contains structured benchmark information that can be manually submitted to the community benchmark dataset.

The GUI **does not automatically write benchmark results to GitHub**.

Users can choose to manually submit their benchmark result to the community repository.

---

# 🏆 Community Benchmarks

The community benchmark system allows MWC miners to build a shared reference of CPU performance across different:

* CPUs
* Architectures
* Operating systems
* Thread counts
* Sugarmaker versions

The GUI retrieves the published community benchmark dataset and allows users to compare their local result against available results.

This makes it easier for the community to see how different CPUs and platforms perform with the MWC-compatible algorithms.

---

# 🛠️ Configuration

Workers configured through the GUI can contain settings such as:

```text
Pool URL
Username / Wallet
Password
Coinbase Address
Threads
Binary Path
Extra Arguments
Autostart
Algorithm
```

The GUI uses these settings to construct and manage the appropriate Sugarmaker mining process.

---

# 📜 License

Sugarmaker is released under the:

**GNU General Public License v2.0**

See [`COPYING`](COPYING) for details.

---

# 🌳 Project

Miners World Coin MWC Sugarmaker:

https://github.com/Miners-World-Coin-MWC/sugarmaker

---

# 👥 Authors & Credits

Original project and upstream contributors:

* Jeff Garzik
* Pooler
* Alexander Peslyak
* Kanon

Further development, optimization, MWC integration, cross-platform builds, GUI tooling and benchmark infrastructure are maintained by the **Miners World Coin (MWC) community**.

---

## 💚 Miners World Coin

**CPU-Mineable • Fair Launch • Community & Charity Driven**

Sugarmaker is part of the Miners World Coin ecosystem and is developed to make CPU mining more accessible while providing useful tools for miners to test, monitor and compare their hardware.
