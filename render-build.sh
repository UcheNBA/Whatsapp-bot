#!/usr/bin/env bash
# exit on error
set -o errexit

npm install

# Install Chromium and its dependencies
npx puppeteer install

echo "Build process completed"
npx puppeteer install