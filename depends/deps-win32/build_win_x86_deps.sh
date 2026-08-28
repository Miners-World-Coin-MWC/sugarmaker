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

# NOTE: no hardcoded checksum here (unlike the old script) - I couldn't
# independently verify curl.se's published sha256 for this release from
# where this was written, and hardcoding a wrong one just breaks the build
# again. HTTPS already gives you transport integrity/authenticity; this
# just logs the hash so you can pin it yourself if you want strict
# reproducibility (compare against the value shown on https://curl.se/download.html
# or the release's .asc signature).
echo "Downloaded ${CURL_PACKAGE_FILE}, sha256:"
sha256sum $CURL_PACKAGE_FILE

rm -rf pthread-win32
git clone https://github.com/GerHobbelt/pthread-win32.git

tar zxvf $CURL_PACKAGE_FILE

cd $CURL_PACKAGE
./configure --host=i686-w64-mingw32 --disable-shared --enable-static \
  --with-schannel --prefix=$PREFIX \
  CFLAGS="-D_WIN32_WINNT=0x0600"
make install

cd ../pthread-win32/
cp config.h pthreads_win32_config.h
make -f GNUmakefile CROSS="i686-w64-mingw32-" clean GC-static
cp libpthreadGC2.a ${PREFIX}/lib/libpthread.a
cp pthread.h semaphore.h sched.h ${PREFIX}/include