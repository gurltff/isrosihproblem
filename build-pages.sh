#!/usr/bin/env sh
# Build the static, server-less version of the app into ./app for GitHub Pages.
# The repository root index.html redirects there.
set -e
cd "$(dirname "$0")"
(cd frontend && VITE_STATIC=1 npx vite build --base ./ --outDir ../app --emptyOutDir)
python3 backend/scripts/export_static.py app
touch .nojekyll
