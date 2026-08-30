#!/bin/bash
set -e
PREFIX=${PWD}/x86_64-w64-mingw32

# See build_win_x86_deps.sh for why this was bumped off curl 7.54.1 and
# switched from --with-winssl to --with-schannel.
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
./configure --host=x86_64-w64-mingw32 --disable-shared --enable-static --with-schannel --prefix=$PREFIX
make install

cd ../pthread-win32/
cp config.h pthreads_win32_config.h
make -f GNUmakefile CROSS="x86_64-w64-mingw32-" clean GC-static
cp libpthreadGC2.a ${PREFIX}/lib/libpthread.a
cp pthread.h semaphore.h sched.h ${PREFIX}/include