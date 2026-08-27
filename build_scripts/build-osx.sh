# try on virtualbox ubuntu 16.04
# https://gist.github.com/quagliero/90f493f123c7b1ddba5428ba0146329a

# CLEAN
make distclean || echo clean
rm -f config.status

# HOTFIX for OSX
./autogen.sh
sed -i '' '/LIBCURL_CHECK_CONFIG/d' ./configure
sed -i '' '/AC_MSG_ERROR/d' ./configure

# BUILD
./autogen.sh
./configure CFLAGS="-Wall -O2 -fomit-frame-pointer" --with-crypto=/usr/local/opt/openssl --with-curl
make
strip sugarmaker

# CHECK STATIC
file sugarmaker | grep "statically linked"

# PACKAGE
RELEASE=sugarmaker-v2.5.0-sugar4-osx
rm -rf $RELEASE
mkdir $RELEASE
cp ./mining-script/sh/*.sh $RELEASE/
cp sugarmaker $RELEASE/

# SIGN
zip -r $RELEASE/$RELEASE.zip $RELEASE/*
# sha256sum $RELEASE/$RELEASE.zip > $RELEASE/$RELEASE
shasum -a 256 $RELEASE/$RELEASE.zip > $RELEASE/$RELEASE
gpg --digest-algo sha256 --clearsign $RELEASE/$RELEASE
rm $RELEASE/$RELEASE && cat $RELEASE/$RELEASE.asc
