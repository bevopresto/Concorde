#!/bin/bash
# Runs Concorde on a Mac straight from the project folder (no installer needed).
# It keeps its working copy in ~/ConcordeMac, outside OneDrive, so OneDrive never has to sync the big Mac files.
# Each time you open it, it copies across the latest version of the app first.
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
RUN="$HOME/ConcordeMac"

pause() { echo; read -n 1 -s -r -p "Press any key to close this window."; echo; }

if ! command -v node >/dev/null 2>&1; then
  echo "Concorde needs Node.js, which isn't installed on this Mac yet."
  echo "Get the LTS installer from https://nodejs.org , install it, then open this file again."
  pause; exit 1
fi

echo "Getting the latest Concorde files..."
mkdir -p "$RUN/desktop" || { echo "Couldn't create $RUN"; pause; exit 1; }
rsync -a --delete --exclude node_modules --exclude app --exclude dist "$ROOT/desktop/" "$RUN/desktop/" || { echo "Couldn't copy the desktop files."; pause; exit 1; }
for d in css js assets; do rsync -a --delete "$ROOT/$d/" "$RUN/$d/" || { echo "Couldn't copy $d."; pause; exit 1; }; done
cp "$ROOT/index.html" "$RUN/index.html" || { echo "Couldn't copy index.html."; pause; exit 1; }

cd "$RUN/desktop" || exit 1
# Mac only needs Electron itself, not the Windows installer tools.
node -e "const fs=require('fs'),p=JSON.parse(fs.readFileSync('package.json'));delete p.devDependencies['electron-builder'];fs.writeFileSync('package.json',JSON.stringify(p,null,2))"

if [ -n "$CONCORDE_DRY" ]; then echo "Dry run: files are in $RUN"; exit 0; fi

if [ ! -x node_modules/.bin/electron ]; then
  echo "First run: downloading Electron (a few minutes, once only)..."
  npm install --no-audit --no-fund || { echo "The download failed. Check your internet and try again."; pause; exit 1; }
fi

node scripts/prepare.js || { pause; exit 1; }
echo "Starting Concorde. You can close this window once it opens; Concorde keeps running."
nohup ./node_modules/.bin/electron . >/dev/null 2>&1 &
sleep 2
