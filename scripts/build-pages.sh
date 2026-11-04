#!/usr/bin/env bash
# Build the Cloudflare Pages static export of FreeTTS.
#
# next-on-pages does not support Next.js 16, so Pages gets a pure static
# export: PAGES_EXPORT=1 switches next.config.ts to `output: "export"`.
# The dev/test-only app/api/verify-assets route cannot be statically
# exported, so it is moved aside for the build and restored afterwards
# (it 404s in production anyway unless FREETTS_VERIFY_ASSETS=1).
# COOP/COEP headers for the export come from public/_headers.
set -euo pipefail
cd "$(dirname "$0")/.."
# Drop stale build output (dev type validator references app/api; a previous
# partial export's out/ would otherwise be type-checked).
rm -rf .next out
if [ -d app/api ]; then
  mv app/api /tmp/freetts-api.bak
  trap 'mv /tmp/freetts-api.bak app/api' EXIT
fi
PAGES_EXPORT=1 npx next build
