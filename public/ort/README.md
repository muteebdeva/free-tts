# Shipped ONNX Runtime WASM binaries

Same-origin copy of the WASM binaries the vendored onnxruntime-web 1.22.0
(via kokoro-js) loads at session init. Used when the device profile selects
the `same-origin` WASM base (COMPATIBILITY): `env.wasmPaths` is pointed at
`/ort/` so inference never depends on the jsdelivr CDN default (and its
version-skew 404 risk — see docs/BOTTLENECKS.md #7).

Measured runtime behavior (verify gate asserts this): the vendored ORT
**always** requests the `ort-wasm-simd-threaded.jsep.*` filenames, even on
the pure-WASM execution path — there is no code path in this build that
requests the non-JSEP `ort-wasm-simd-threaded.*` names. Both pairs are
shipped: the jsep pair is what actually loads; the non-jsep pair is kept
for forward-compat with a future ORT that selects it.
