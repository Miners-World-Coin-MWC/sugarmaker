#!/bin/bash
# build-android-aarch64.sh
# Build Sugarmaker for Android ARM64 (arm64-v8a)
# Requires deps-android-aarch64.sh to have been run

set -e

# ----------- CONFIG -----------
NDK=${NDK:-/path/to/android-ndk}
TOOLCHAIN=$NDK/toolchains/llvm/prebuilt/linux-x86_64
TARGET=aarch64-linux-android
API=21
DEPS_PREFIX=$(pwd)/android-build
THREADS=$(nproc)

echo "=== Using NDK: $NDK ==="
echo "=== Dependencies prefix: $DEPS_PREFIX ==="

# ----------- CLEAN ----------
echo "=== Cleaning previous builds ==="
make distclean || echo "clean skipped"
rm -f config.status

# ----------- BUILD ----------
echo "=== Running autogen.sh ==="
./autogen.sh

echo "=== Configuring Sugarmaker for Android ==="

export CC=$TOOLCHAIN/bin/$TARGET$API-clang
export CXX=$TOOLCHAIN/bin/$TARGET$API-clang++
export AR=$TOOLCHAIN/bin/$TARGET-ar
export AS=$TOOLCHAIN/bin/$TARGET-as
export LD=$TOOLCHAIN/bin/$TARGET-ld
export RANLIB=$TOOLCHAIN/bin/$TARGET-ranlib
export STRIP=$TOOLCHAIN/bin/$TARGET-strip

# Compiler flags
export CFLAGS="-O3 -fPIE -fomit-frame-pointer -I$DEPS_PREFIX/include"
export LDFLAGS="-pie -L$DEPS_PREFIX/lib"
export LIBS="-lssl -lcrypto -lz -lpthread -ldl"

./configure \
  --host=$TARGET \
  --with-curl="$DEPS_PREFIX" \
  --with-crypto="$DEPS_PREFIX" \
  CFLAGS="$CFLAGS" \
  LDFLAGS="$LDFLAGS" \
  LIBS="$LIBS"

echo "=== Building Sugarmaker ==="
make -j$THREADS

echo "=== Stripping binary ==="
$STRIP -s sugarmaker

echo "=== Checking binary ==="
file sugarmaker | grep "statically linked" || echo "Warning: not fully static"

# ----------- PACKAGE ----------
RELEASE=sugarmaker-android-arm64
rm -rf $RELEASE
mkdir -p $RELEASE
cp ./mining-script/sh/*.sh $RELEASE/ || echo "No mining scripts found, skipping"
cp sugarmaker $RELEASE/

echo "=== Creating zip ==="
zip -r $RELEASE/$RELEASE.zip $RELEASE

echo "=== SHA256 sum ==="
sha256sum $RELEASE/$RELEASE.zip > $RELEASE/$RELEASE.zip.sha256

echo "=== Sugarmaker Android ARM64 build complete ==="
