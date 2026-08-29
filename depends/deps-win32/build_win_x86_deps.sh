#!/bin/bash
set -e

PREFIX=${PWD}/i686-w64-mingw32

# curl 7.54.1 (2017) is pinned here historically, but its bundled libtool
# archive-command generation has a known incompatibility with modern
# binutils `ar` (fails with "ar: libcurl_la-file.o: No such file or
# directory" when assembling libcurl.la under a mingw cross-host). Bumping
# to a current release avoids that whole class of bug. `--with-winssl` was
# curl's old flag name for Windows-native TLS; current curl calls it
# `--with-schannel`.
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

# Verify the dependency installation before leaving this script.
echo "===== i686 dependency verification ====="

test -f "${PREFIX}/include/curl/curl.h"
test -f "${PREFIX}/lib/libcurl.a"
test -f "${PREFIX}/lib/libpthread.a"

echo "curl headers:    ${PREFIX}/include/curl/curl.h"
echo "curl library:    ${PREFIX}/lib/libcurl.a"
echo "pthread library: ${PREFIX}/lib/libpthread.a"

echo "Checking curl_easy_init symbol:"
i686-w64-mingw32-nm "${PREFIX}/lib/libcurl.a" \
  | grep "curl_easy_init" \
  | head -5 || true

echo "===== dependency verification complete ====="