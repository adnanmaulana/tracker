#!/usr/bin/env bash
# Sends a few sample events to the local API.
set -euo pipefail
API="${API:-http://localhost:8080}"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

echo "single pageview:"
curl -sS -X POST "$API/e" -H "Origin: http://localhost:3000" -H "User-Agent: $UA" \
  -H "Content-Type: text/plain" \
  -d '{"site":"portfolio","name":"pageview","url":"http://localhost:3000/?utm_source=github","referrer":"https://github.com/"}'
echo

echo "batch of custom events:"
curl -sS -X POST "$API/e" -H "Origin: http://localhost:3000" -H "User-Agent: $UA" \
  -H "Content-Type: text/plain" \
  -d '[
    {"site":"portfolio","name":"project_click","url":"http://localhost:3000/projects","props":{"project":"reanimated-cookbook"}},
    {"site":"reanimated-cookbook","name":"copy_snippet","url":"http://localhost:3000/recipes/swipe","props":{"recipe":"gesture-swipe"}}
  ]'
echo
