#!/usr/bin/env sh
# Build the static, server-less version of the app into ./app for GitHub Pages.
# The repository root index.html redirects there.
set -e
cd "$(dirname "$0")"
# Keep the previous build's scripts: a browser still holding the old page
# (GitHub Pages caches HTML for 10 minutes) can then still load them.
old=$(mktemp -d); [ -d app/assets ] && cp -r app/assets "$old/"
(cd frontend && VITE_STATIC=1 npx vite build --base ./ --outDir ../app --emptyOutDir)
[ -d "$old/assets" ] && cp -rn "$old/assets/." app/assets/
rm -rf "$old"
python3 backend/scripts/export_static.py app
touch .nojekyll
