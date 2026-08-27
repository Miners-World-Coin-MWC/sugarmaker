# CLEAN
make distclean || echo clean
rm -f config.status

# DEPS
# cd deps-win32
# ./build_win_x86_deps.sh
# cd ..

# BUILD
autoreconf -fi -I./deps-win32/i686-w64-mingw32/share/aclocal
./autogen.sh
./configure --host=i686-w64-mingw32 LDFLAGS="-L./deps-win32/i686-w64-mingw32/lib -static" CFLAGS="-Wall -O2 -fomit-frame-pointer -I./deps-win32/i686-w64-mingw32/include -std=c99 -DWIN32 -DCURL_STATICLIB -DPTW32_STATIC_LIB" --with-libcurl=deps-win32/i686-w64-mingw32
make
strip -p --strip-debug --strip-unneeded sugarmaker.exe

# PACKAGE
RELEASE=sugarmaker-v2.5.0-sugar4-w32
rm -rf $RELEASE
mkdir $RELEASE

cp ./mining-script/bat/*.bat $RELEASE/
mv sugarmaker.exe $RELEASE/

# SIGN
zip -X $RELEASE/$RELEASE.zip $RELEASE/*
sha256sum $RELEASE/$RELEASE.zip > $RELEASE/$RELEASE
gpg --digest-algo sha256 --clearsign $RELEASE/$RELEASE
rm $RELEASE/$RELEASE && cat $RELEASE/$RELEASE.asc
