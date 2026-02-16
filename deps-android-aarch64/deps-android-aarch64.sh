#!/bin/bash
# deps-android-aarch64.sh
# Build OpenSSL + libcurl for Android ARM64 (aarch64, arm64-v8a)
# Fully CI-friendly — uses NDK provided by GitHub Actions

set -e

# ----------- CONFIG -----------
# NDK path should be set via environment (CI will do this)
if [ -z "$NDK" ]; then
  echo "ERROR: NDK environment variable not set!"
  exit 1
fi

TOOLCHAIN=$NDK/toolchains/llvm/prebuilt/linux-x86_64
TARGET=aarch64-linux-android
API=21
PREFIX=$(pwd)/android-build
mkdir -p $PREFIX

THREADS=$(nproc)

echo "=== Using NDK: $NDK ==="
echo "=== Output prefix: $PREFIX ==="

# ----------- OPENSSL -----------
echo "=== Building OpenSSL for Android ARM64 ==="

OPENSSL_VERSION=1.1.0g
wget https://www.openssl.org/source/openssl-$OPENSSL_VERSION.tar.gz
tar -xvzf openssl-$OPENSSL_VERSION.tar.gz
cd openssl-$OPENSSL_VERSION

export PATH=$TOOLCHAIN/bin:$PATH
export AR=$TOOLCHAIN/bin/$TARGET-ar
export AS=$TOOLCHAIN/bin/$TARGET-as
export CC=$TOOLCHAIN/bin/$TARGET$API-clang
export CXX=$TOOLCHAIN/bin/$TARGET$API-clang++
export LD=$TOOLCHAIN/bin/$TARGET-ld
export RANLIB=$TOOLCHAIN/bin/$TARGET-ranlib
export STRIP=$TOOLCHAIN/bin/$TARGET-strip

./Configure android-arm64 no-shared no-unit-test --prefix=$PREFIX
make -j$THREADS
make install
cd ..

# ----------- CURL -----------
echo "=== Building libcurl for Android ARM64 ==="

CURL_VERSION=7.57.0
wget https://github.com/curl/curl/releases/download/curl-7_57_0/curl-$CURL_VERSION.tar.gz
tar -xvzf curl-$CURL_VERSION.tar.gz
cd curl-$CURL_VERSION

export PKG_CONFIG_PATH=$PREFIX/lib/pkgconfig
export CFLAGS="-O3 -fPIC --sysroot=$TOOLCHAIN/sysroot"
export LDFLAGS="-L$PREFIX/lib -static-libgcc"

./buildconf
./configure \
  --host=$TARGET \
  --with-ssl=$PREFIX \
  --disable-shared \
  --enable-static \
  --prefix=$PREFIX
make -j$THREADS
make install
cd ..

echo "=== Android ARM64 dependencies built successfully ==="
echo "Install prefix: $PREFIX"
