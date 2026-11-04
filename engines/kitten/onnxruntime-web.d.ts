/**
 * Type shim for `onnxruntime-web`.
 *
 * The package ships its types as ambient `declare module` blocks in
 * types.d.ts (referenced by package.json "types"), but its `exports` map
 * has no "types" condition, so `moduleResolution: bundler` never loads
 * them (TS7016). This reference pulls the ambient declarations in; it is
 * type-only and does not affect bundling.
 */
/// <reference path="../../node_modules/onnxruntime-web/types.d.ts" />
