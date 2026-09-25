#!/usr/bin/env sh
# Build the static, server-less version of the app into ./app for GitHub Pages.
# The repository root index.html redirects there.
set -e
cd "$(dirname "$0")"

# Guard: an effect written as `useEffect(() => expr)` returns expr to React as
# its cleanup. Newer Chrome makes scrollTo return a Promise, which crashed every
# page change ("a is not a function"). Effects must use a block body.
if grep -rnE "useEffect\(\(\) => [^{(]" frontend/src | grep -v "useEffect(() => () =>"; then
  echo "error: write effects as useEffect(() => { ... }) (see comment above)" >&2
  exit 1
fi
# Pre-render the API first: the static build compiles the lot-level answers in.
rm -rf frontend/.static && python3 backend/scripts/export_static.py frontend/.static
cp frontend/.static/api/bundle.json frontend/.static/bundle.json

# Keep the previous build's scripts: a browser still holding the old page
# (GitHub Pages caches HTML for 10 minutes) can then still load them.
old=$(mktemp -d); [ -d app/assets ] && cp -r app/assets "$old/"
(cd frontend && VITE_STATIC=1 npx vite build --base ./ --outDir ../app --emptyOutDir)
[ -d "$old/assets" ] && cp -rn "$old/assets/." app/assets/
rm -rf "$old"
cp -r frontend/.static/api app/api
touch .nojekyll
