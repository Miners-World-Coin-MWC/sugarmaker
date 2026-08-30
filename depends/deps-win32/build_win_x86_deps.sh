#!/bin/bash
set -e

PREFIX=${PWD}/i686-w64-mingw32

CURL_VERSION=8.19.0
CURL_PACKAGE=curl-${CURL_VERSION}
CURL_PACKAGE_FILE=${CURL_PACKAGE}.tar.gz

wget https://curl.se/download/$CURL_PACKAGE_FILE -O $CURL_PACKAGE_FILE

echo "Downloaded ${CURL_PACKAGE_FILE}, sha256:"
sha256sum $CURL_PACKAGE_FILE

rm -rf pthread-win32
git clone https://github.com/GerHobbelt/pthread-win32.git

tar zxvf $CURL_PACKAGE_FILE

cd $CURL_PACKAGE

./configure \
  --host=i686-w64-mingw32 \
  --without-libpsl \
  --disable-shared \
  --enable-static \
  --with-schannel \
  --prefix="$PREFIX" \
  CFLAGS="-D_WIN32_WINNT=0x0600"

make install

cd ../pthread-win32/

cp config.h pthreads_win32_config.h

# Build pthread-win32 static library.
#
# PTW32_CLEANUP_C is required by the current version of version.rc.
# __CLEANUP_C is retained for compatibility with the pthread sources.

make -f GNUmakefile \
  CROSS="i686-w64-mingw32-" \
  clean

make -f GNUmakefile \
  CROSS="i686-w64-mingw32-" \
  CFLAGS="-DPTW32_CLEANUP_C -D__CLEANUP_C" \
  RCFLAGS="-DPTW32_CLEANUP_C -D__CLEANUP_C" \
  GC-static

cp libpthreadGC2.a "${PREFIX}/lib/libpthread.a"
cp pthread.h semaphore.h sched.h "${PREFIX}/include"

# pthread.h #includes "_ptw32.h" internally - without copying it too,
# anything that includes pthread.h (i.e. sugarmaker's own miner.h) fails
# with "fatal error: _ptw32.h: No such file or directory".
cp _ptw32.h "${PREFIX}/include"

# Verify the dependency installation before leaving this script.
echo "===== i686 dependency verification ====="

test -f "${PREFIX}/include/curl/curl.h"
test -f "${PREFIX}/lib/libcurl.a"
test -f "${PREFIX}/lib/libpthread.a"
test -f "${PREFIX}/include/_ptw32.h"

echo "curl headers:    ${PREFIX}/include/curl/curl.h"
echo "curl library:    ${PREFIX}/lib/libcurl.a"
echo "pthread library: ${PREFIX}/lib/libpthread.a"

echo "Checking curl_easy_init symbol:"
i686-w64-mingw32-nm "${PREFIX}/lib/libcurl.a" \
  | grep "curl_easy_init" \
  | head -5 || true

echo "===== dependency verification complete ====="