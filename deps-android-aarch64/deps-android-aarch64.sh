#!/bin/bash
# deps-android-aarch64.sh
# Build OpenSSL + libcurl for Android ARM64 (aarch64, arm64-v8a)
# CI-friendly — works with NDK r26+ (GitHub Actions)

set -e

# ----------- CONFIG -----------
# Detect NDK from PATH if not set
if [ -z "$NDK" ]; then
  if [ -d "$HOME/android-ndk-r26d" ]; then
    export NDK="$HOME/android-ndk-r26d"
  elif command -v ndk-build >/dev/null 2>&1; then
    export NDK=$(dirname $(dirname $(which ndk-build)))
  else
    echo "ERROR: NDK environment variable not set!"
    exit 1
  fi
fi

export ANDROID_NDK_HOME="$NDK"
export ANDROID_NDK_ROOT="$NDK"

TOOLCHAIN=$NDK/toolchains/llvm/prebuilt/linux-x86_64
TARGET=aarch64-linux-android
API=21
PREFIX=$(pwd)/android-build
mkdir -p "$PREFIX"

THREADS=$(nproc)

echo "=== Using NDK: $NDK ==="
echo "=== Output prefix: $PREFIX ==="

# ----------- OPENSSL -----------
echo "=== Building OpenSSL for Android ARM64 ==="

OPENSSL_VERSION=1.1.1t
wget https://www.openssl.org/source/openssl-$OPENSSL_VERSION.tar.gz
tar -xvzf openssl-$OPENSSL_VERSION.tar.gz
cd openssl-$OPENSSL_VERSION

# Export NDK compiler tools
export PATH=$TOOLCHAIN/bin:$PATH
export AR=$TOOLCHAIN/bin/$TARGET-ar
export AS=$TOOLCHAIN/bin/$TARGET-as
export CC=$TOOLCHAIN/bin/$TARGET$API-clang
export CXX=$TOOLCHAIN/bin/$TARGET$API-clang++
export LD=$TOOLCHAIN/bin/$TARGET-ld
export RANLIB=$TOOLCHAIN/bin/$TARGET-ranlib
export STRIP=$TOOLCHAIN/bin/$TARGET-strip

# Configure OpenSSL for Android ARM64 — skip tests to avoid gcc detection
./Configure android-arm64 no-shared no-unit-test --prefix="$PREFIX" --with-cc="$CC"
make -j"$THREADS" build_libs
make install_sw
cd ..

# ----------- CURL -----------
echo "=== Building libcurl for Android ARM64 ==="

CURL_VERSION=7.87.0
wget https://github.com/curl/curl/releases/download/curl-7_87_0/curl-$CURL_VERSION.tar.gz
tar -xvzf curl-$CURL_VERSION.tar.gz
cd curl-$CURL_VERSION

export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
export CFLAGS="-O3 -fPIC --sysroot=$TOOLCHAIN/sysroot -I$PREFIX/include"
export LDFLAGS="-L$PREFIX/lib -static-libgcc"

./buildconf
./configure \
  --host=$TARGET \
  --with-ssl="$PREFIX" \
  --disable-shared \
  --enable-static \
  --prefix="$PREFIX" \
  CC="$CC"
make -j"$THREADS"
make install
cd ..

echo "=== Android ARM64 dependencies built successfully ==="
echo "Install prefix: $PREFIX"
