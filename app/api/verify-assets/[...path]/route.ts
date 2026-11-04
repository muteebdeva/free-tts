import { createReadStream, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { NextRequest } from "next/server";

/**
 * Serves the local verification model mirror: /api/verify-assets/<path>.
 *
 * STRICTLY dev/test-only: returns 404 unless FREETTS_VERIFY_ASSETS=1 is set
 * in the server environment. Serves only files under .verify-assets/ with
 * path-traversal protection. Never enabled in production.
 *
 * Why this exists: the sandbox's egress proxy blocks Chromium's CONNECT
 * tunnels, so the headless browser cannot download models from HuggingFace
 * directly. The mirror lets scripts/verify-audio.mjs prove REAL in-browser
 * inference (the actual gate) without depending on external CDN transport.
 * What runs in the browser — model bytes, WASM runtime, inference — is
 * identical; only the byte source differs. See docs/TEST-REPORT.md.
 */
const ASSETS_ROOT = join(process.cwd(), ".verify-assets");

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".onnx": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (process.env.FREETTS_VERIFY_ASSETS !== "1") {
    return new Response("Not found", { status: 404 });
  }
  const { path } = await params;
  const rel = normalize((path ?? []).join(sep));
  // Block traversal: normalized path must stay inside ASSETS_ROOT.
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
    return new Response("Forbidden", { status: 403 });
  }
  const file = join(ASSETS_ROOT, rel);
  if (!file.startsWith(ASSETS_ROOT + sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  let stat;
  try {
    stat = statSync(file);
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const ext = file.slice(file.lastIndexOf("."));
  const stream = createReadStream(file);
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      // Same-origin embedding is enough (COEP require-corp satisfied).
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
