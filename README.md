# SUGARMAKER
![GitHub All Releases](https://img.shields.io/github/downloads/decryp2kanon/sugarmaker/total)
[![AUR version](https://img.shields.io/aur/version/sugarmaker)](https://aur.archlinux.org/packages/sugarmaker/)

This is a multi-threaded CPU miner for ***Sugarchain***, fork of solardiz's (Resistance) fork of pooler's (Litecoin) fork of Jeff Garzik's (Bitcoin) reference cpuminer. This fork is supporting only Yespower variant algorithms.

License:  [GPLv2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html).  See COPYING for details.

Git tree:  https://github.com/decryp2kanon/sugarmaker

### Build dependencies:
```
autoconf
automake
GNU make
gcc
libcurl	https://curl.haxx.se/libcurl/
```

- On recent Debian and Ubuntu, these can be installed with:
```
sudo apt-get install build-essential libcurl4-openssl-dev autotools-dev automake libtool
```

### Basic Unix build instructions:
```
./autogen.sh
./configure CFLAGS="-Wall -O2 -fomit-frame-pointer" CXXFLAGS="$CFLAGS -std=gnu++11"
make
```

Notes for AIX users:
- To build a 64-bit binary, export `OBJECT_MODE=64`
- GNU-style long options are not supported, but are accessible via configuration file

### Basic Windows build instructions, using MinGW:
- Install MinGW and the MSYS Developer Tool Kit (http://www.mingw.org/)
	* Make sure you have `mstcpip.h` in `MinGW\include`
- If using MinGW-w64, install `pthreads-w64`
- Install `libcurl devel` (https://curl.haxx.se/download.html)
	* Make sure you have `libcurl.m4` in `MinGW\share\aclocal`
	* Make sure you have `curl-config` in `MinGW\bin`
- In the MSYS shell, run:
	```
	./autogen.sh
	LIBCURL='-lcurldll' ./configure
	make
	```

### Usage instructions:
Run `sugarmaker --help` to see options. You can solo-mine using these options:

- Mainnet (Solo)
```
./sugarmaker -o http://127.0.0.1:34229 -u ユーザーネーム -p パスワード --coinbase-addr=sugar1qv0ahzfa2ssu47wes89390sl0jz6g05h0267u8g -t1
```
- Mainnet (Stratum Pool)
```
./sugarmaker -o stratum+tcp://bmine.net:3033 -u sugar1qv0ahzfa2ssu47wes89390sl0jz6g05h0267u8g -t1
```
- Testnet (Solo)
```
./sugarmaker -o http://127.0.0.1:44229 -u ユーザーネーム -p パスワード --coinbase-addr=tugar1qkvl32hmzvgtwpu7v70k5u0kcv9s4uqy4twjge8 -t1
```
- Testnet (Stratum Pool)
```
./sugarmaker -o stratum+tcp://1pool-testnet.cryptozeny.com:3333 -u tugar1qkvl32hmzvgtwpu7v70k5u0kcv9s4uqy4twjge8 -t1
```

(Omit the leading `./` if you're on Windows.)  For the above to work, for solo mining you need
a *fully-synced node* running locally and with RPC username/password configured,

- e.g. with the below in your `.sugarchain/sugarchain.conf`:
```
rpcbind=127.0.0.1
rpcallowip=127.0.0.0/8
rpcuser=ユーザーネーム
rpcpassword=パスワード
```

- Connecting through a proxy:
	* Use the `--proxy` option.
	* To use a SOCKS proxy, add a `socks4://` or `socks5://` prefix to the proxy host.
	* Protocols `socks4a` and `socks5h`, allowing remote name resolving, are also available since libcurl 7.18.0.
	* If no protocol is specified, the proxy is assumed to be a HTTP proxy.
	* When the `--proxy` option is not used, the program honors the `http_proxy` and `all_proxy` environment variables.

### Author
- Jeff Garzik
- Pooler
- Alexander Peslyak
- Kanon

### Support and donation
If you happy with this sugarmaker, please support devloper for better performance in near future!
- Kanon (sugarchain developer) https://keybase.io/decryp2kanon
	* BTC
		- `1JojGCHLpEVMv6Z28y9gN6jUXtGF2ioEUV` (legacy)
		- `bc1qqe30mhqdkjfszzc4pex5udvay2ay6w0htgwtax` (bech32)
	* SUGAR:
		- `sugar1qv0ahzfa2ssu47wes89390sl0jz6g05h0267u8g`
