#!/usr/bin/env bash
# Build the Cloudflare Pages static export of FreeTTS.
#
# next-on-pages does not support Next.js 16, so Pages gets a pure static
# export: PAGES_EXPORT=1 switches next.config.ts to `output: "export"`.
# The dev/test-only routes app/api/verify-assets and app/verify cannot be
# statically exported (and must NOT ship to production), so they are moved
# aside for the build and restored afterwards (they 404 in production
# anyway unless FREETTS_VERIFY_ASSETS=1).
# Set INCLUDE_VERIFY=1 to keep app/verify in the artifact — used ONLY by
# scripts/verify-pages.mjs --stream, which gates a with-verify build.
# COOP/COEP headers for the export come from public/_headers.
set -euo pipefail
cd "$(dirname "$0")/.."
# Drop stale build output (dev type validator references app/api; a previous
# partial export's out/ would otherwise be type-checked).
rm -rf .next out
restore() {
  if [ -d /tmp/freetts-api.bak ]; then mv /tmp/freetts-api.bak app/api; fi
  if [ -d /tmp/freetts-verify.bak ]; then mv /tmp/freetts-verify.bak app/verify; fi
}
if [ -d app/api ]; then
  mv app/api /tmp/freetts-api.bak
  trap restore EXIT
fi
if [ -d app/verify ] && [ "${INCLUDE_VERIFY:-}" != "1" ]; then
  mv app/verify /tmp/freetts-verify.bak
  trap restore EXIT
fi
PAGES_EXPORT=1 npx next build
