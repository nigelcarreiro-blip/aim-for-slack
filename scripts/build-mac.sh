#!/bin/zsh
# Builds dist/AIM.app from the local Electron install. Pass --install to copy it into /Applications.
set -e
cd "${0:a:h}/.."
[ -d node_modules/electron/dist/Electron.app ] || { echo "Run npm install first."; exit 1; }
APP=dist/AIM.app
R=$APP/Contents/Resources
rm -rf "$APP" && mkdir -p dist
cp -R node_modules/electron/dist/Electron.app "$APP"
rm -f "$R/default_app.asar"
mkdir -p "$R/app/node_modules"
cp -R main.js bridge.js embedded.js settings.js demo.js preload.js package.json ui assets "$R/app/"
cp -R node_modules/ws "$R/app/node_modules/"
cp assets/icon/AIM.icns "$R/electron.icns"
P=$APP/Contents/Info.plist
plutil -replace CFBundleName -string AIM "$P"
plutil -replace CFBundleDisplayName -string AIM "$P"
plutil -replace CFBundleIdentifier -string com.github.aim-for-slack "$P"
codesign --force --deep -s - "$APP"
echo "Built $APP"
if [[ "$1" == "--install" ]]; then
  pkill -f "AIM.app/Contents/MacOS" || true
  rm -rf /Applications/AIM.app && cp -R "$APP" /Applications/AIM.app
  echo "Installed /Applications/AIM.app"
fi
