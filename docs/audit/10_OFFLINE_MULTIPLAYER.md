# Offline and Nearby audit — 15 October 2026

Nearby uses browser WebRTC data channels and manually exchanged invitation/reply codes. Both devices must first cache the app online. Bluetooth-only gameplay is unsupported. Normal Ken AI uses the native server and is not an on-device offline engine.

## Repairs and verified behavior

Connection-generation checks prevent old asynchronous pairing work from restoring a discarded code or connection. Reset/leave invalidates callbacks, an active Nearby view survives account restoration, and navigation asks before leaving an active peer. Shared local rules validate received moves; unsolicited draw/rematch acceptances are rejected. Deterministic rule/lifecycle checks are included in the complete unit suite.

`CHROME_NO_SANDBOX=1 E2E_APP_URL=http://127.0.0.2:8126 npm run test:offline` passed with the real production service worker. It verified a secure loopback context, Nearby's dependency closure in the install cache, TV excluded from that closure, and successful Nearby opening and reload after browser networking was disabled.

`npm run test:nearby` was attempted in isolated Chromium contexts. The browser gathered zero host ICE candidates and the UI displayed an explicit error without producing an unusable connection code. Managed `WebRtcIPHandling=disable_non_proxied_udp` prevents this environment from establishing local peer transport. This outcome is unavailable, not a passing two-device game. The managed policy was not bypassed.

## Required device checks

Pair two real supported phones on Wi-Fi/hotspot; play through captures, king moves, draw/resign/rematch, navigation, screen lock and disconnect. Verify cached loading and browser restrictions on Safari/Android. There is no established active peer recovery after a browser/process restart, and cached UI loading cannot prove a working data channel.
