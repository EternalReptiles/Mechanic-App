#!/usr/bin/env bash
# Builds the app and publishes it to Netlify (https://mechanic-app-au.netlify.app).
# Needs a Netlify personal access token in NETLIFY_AUTH_TOKEN.
set -euo pipefail
SITE_ID="5c5c2436-4613-43fb-9fed-098144d6cf02"
cd "$(dirname "$0")/.."
npm run build
ZIP="$(mktemp -d)/dist.zip"
(cd dist && python3 -c "
import os, sys, zipfile
z = zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED)
for root, _, files in os.walk('.'):
    for f in files:
        p = os.path.join(root, f)
        z.write(p, os.path.relpath(p, '.'))
z.close()" "$ZIP")
curl -fsS -X POST -H "Authorization: Bearer ${NETLIFY_AUTH_TOKEN}" -H "Content-Type: application/zip" \
  --data-binary @"$ZIP" "https://api.netlify.com/api/v1/sites/$SITE_ID/deploys" \
  | python3 -c "import sys, json; d = json.load(sys.stdin); print('Deploy', d['id'], d['state'])"
