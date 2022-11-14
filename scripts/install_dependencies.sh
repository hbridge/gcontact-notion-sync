#!/bin/bash
cd /var/node/google-notion-sync

curl --silent --location https://rpm.nodesource.com/setup_6.x | bash -
curl -fsSL https://deb.nodesource.com/setup_19.x | sudo -E bash
sudo apt-get install -y nodejs
npm install
# sudo npm install -g pm2
# npm install