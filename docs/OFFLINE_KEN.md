# Ken offline

Open `/?offline=ken`, or choose **Play Ken Offline · Full Strength** on the sign-in screen. Nearby Offline also links to it. Open the deployed app online once and allow its service worker to finish preparing files before disconnecting. The first download includes an approximately 8.4 MiB WebAssembly engine with its original Nigerian evaluation weights.

The existing C++ engine runs inside a dedicated Web Worker. Practice uses full pattern evaluation, zero handicap, no artificial depth cap (the engine's own maximum is 99), and no weakening node budget. Choose 5, 15 or 30 seconds per move. Search runs on one CPU thread so browsers do not require special cross-origin isolation headers; performance depends on the device. Leaving or restarting the match terminates the active worker. The original game rules, move validation and draw adjudication are shared unchanged.

Offline practice is separate from server-verified matches: it never calls the engine API, accesses a wallet, awards coins or unlocks ranked levels. Existing online matches and financial checks retain their server protections. Local practice progress currently lasts for the open page.

## Rebuilding

Ordinary `npm ci` and `npm run build` use the checked-in `public/engine/scan.js` and `scan.wasm`. To rebuild them from source, install Emscripten **3.1.74**, activate its environment, then run `npm run build:offline-engine`. `nd_upgraded/wasm.cpp` is the browser adapter; the rules, search and weights remain the original engine sources. No pthreads, external CDN, API keys or remote model are required by the offline engine.

Deploy the updated application before expecting the live site to have this feature. Supabase project bindings remain unchanged.
