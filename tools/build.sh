#!/usr/bin/env bash
# Package for the Chrome Web Store (also Brave/Edge) and Firefox AMO.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(python3 -c 'import json;print(json.load(open("extension/manifest.json"))["version"])')
rm -rf dist && mkdir -p dist/chrome dist/firefox
cp -r extension/. dist/chrome/
cp -r extension/. dist/firefox/
python3 - <<'PY'
import json
p = "dist/firefox/manifest.json"
m = json.load(open(p))
m["background"] = {"scripts": ["lib/shazam.js", "background.js"]}
m["browser_specific_settings"] = {"gecko": {"id": "songfinder@songfinder.app", "strict_min_version": "128.0",
    "data_collection_permissions": {"required": ["websiteContent"]}}}
json.dump(m, open(p, "w"), indent=2)
PY
(cd dist/chrome  && zip -qr "../songfinder-chrome-$VERSION.zip" .)
(cd dist/firefox && zip -qr "../songfinder-firefox-$VERSION.zip" .)
ls -l dist/*.zip

# keep the website's copy of the popup styles in sync
cp extension/popup.css docs/assets/popup.css
