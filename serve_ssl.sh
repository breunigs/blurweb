#!/bin/bash

set -eu

mkdir -p ssl/
if [ ! -e "ssl/selfsigned.crt" ]; then
  cd ssl/
  openssl genrsa -out selfsigned.key 2048
  openssl req -new -key selfsigned.key -out selfsigned.csr -subj "/C=XX/CN=foobar"
  openssl x509 -req -days 365 -in selfsigned.csr -signkey selfsigned.key -out selfsigned.crt
  cd ..

  echo
  echo
  echo "Generated a self-signed SSL certificate and stored it in ./ssl"
  echo "Delete that folder to create a new certificate"
  echo
  echo
fi

exec ./serve.sh --ssl-cert ssl/selfsigned.crt --ssl-key ssl/selfsigned.key
