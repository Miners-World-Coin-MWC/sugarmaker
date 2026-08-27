# try on virtualbox ubuntu 16.04
# https://lxadm.com/Static_compilation_of_cpuminer

# CLEAN
make distclean || echo clean
rm -f config.status

# DEPENDS
# cd deps-linux64/
# ./deps-linux64.sh
# cd ..

# BUILD
./autogen.sh
./configure CFLAGS="-Wall -O2 -fomit-frame-pointer" LDFLAGS="-static" CXXFLAGS="$CFLAGS -std=gnu++11" --with-curl=/usr/local/
make
strip -s sugarmaker

# CHECK STATIC
file sugarmaker | grep "statically linked"

# PACKAGE
RELEASE=sugarmaker-v2.5.0-sugar4-linux64
rm -rf $RELEASE
mkdir $RELEASE
cp ./mining-script/sh/*.sh $RELEASE/
cp sugarmaker $RELEASE/

# SIGN
zip -X $RELEASE/$RELEASE.zip $RELEASE/*
sha256sum $RELEASE/$RELEASE.zip > $RELEASE/$RELEASE
gpg --digest-algo sha256 --clearsign $RELEASE/$RELEASE
rm $RELEASE/$RELEASE && cat $RELEASE/$RELEASE.asc
