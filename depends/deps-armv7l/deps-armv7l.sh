# WARNING
# Try on Virtual Machine (Ubuntu 16.04)
# https://lxadm.com/Static_compilation_of_cpuminer

# DEPENDS

## OPENSSL
wget https://www.openssl.org/source/openssl-1.1.0g.tar.gz
tar -xvzf openssl-1.1.0g.tar.gz
cd openssl-1.1.0g/
./config no-shared
make -j$(nproc)
sudo make install
cd ..

## CURL
wget https://github.com/curl/curl/releases/download/curl-7_57_0/curl-7.57.0.tar.gz
tar -xvzf curl-7.57.0.tar.gz
cd curl-7.57.0/
./buildconf | grep "buildconf: OK"
./configure --disable-shared | grep "Static=yes"
make -j$(nproc)
sudo make install
cd ../..
