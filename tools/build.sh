#!/usr/bin/env bash
# Build store packages into dist/ (git-ignored):
#   songfinder-chrome-<v>.zip   Chrome Web Store (also Brave / Edge)
#   songfinder-firefox-<v>.zip  Firefox Add-ons (AMO)
#   songfinder-source-<v>.zip   source for AMO review, from the committed tree
#   SHA256SUMS
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
# Firefox runs MV3 background code as an event page, not a service worker.
m["background"] = {"scripts": ["lib/shazam.js", "background.js"]}
m["browser_specific_settings"] = {"gecko": {
    "id": "songfinder@songfinder.app",
    "strict_min_version": "142.0",
    # the audio fingerprint of what the user chooses to identify is sent to a recognition service
    "data_collection_permissions": {"required": ["websiteContent"]},
}}
json.dump(m, open(p, "w"), indent=2)
PY

# sorted entries, no extra file attributes (-X)
(cd dist/chrome  && find . -type f | sort | sed 's|^\./||' | TZ=UTC zip -qX -@ "../songfinder-chrome-$VERSION.zip")
(cd dist/firefox && find . -type f | sort | sed 's|^\./||' | TZ=UTC zip -qX -@ "../songfinder-firefox-$VERSION.zip")
git archive --format=zip --prefix="songfinder.app-$VERSION/" -o "dist/songfinder-source-$VERSION.zip" HEAD
(cd dist && sha256sum ./*.zip | sed 's|\./||' > SHA256SUMS)

# keep the website's copy of the popup styles in sync
cp extension/popup.css docs/assets/popup.css

ls -l dist/*.zip
