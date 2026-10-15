# Remaining issues — 15 October 2026

Readiness: **READY ONLY FOR STAGING**. Source repairs and local checks do not install hosted migrations or certify the connected Supabase project's state.

## P0 — critical

No unresolved P0 was reproduced in the executed final local checks. This is bounded evidence, not a claim that the application or live deployment has no unknown critical defects. Source privacy repairs are not active on an existing hosted database until the reviewed migrations are applied. The actual hosted schema and user data were not inspected.

## P1 — release blockers or substantial gaps

1. Rehearse upgrades on an isolated copy of the real Supabase schema/data, then verify genuine Auth, reset emails, permissions, PostgREST/Realtime, canonical ratings, wallet reconciliation and private tournament access. No callable Supabase connector or injected project credentials were available to this execution environment; the user's account connection alone does not supply this evidence.
2. Active rooms/clocks/session ownership remain in memory and do not resume after a server restart. Completed archive preservation is tested; drain live games before upgrades. Multiple Node writers or horizontal replicas are unsupported by local JSON room/archive authority.
3. A complete authoritative tournament pairing/scheduling/live-game/standings worker and a persisted group backend remain unfinished. Existing transactions are locally tested, but paid event operation and payouts require staging acceptance and operator review.
4. Purchased AI level controls are not an API entitlement boundary: the public analysis/engine interface accepts bounded strength parameters without an authoritative per-level contract. Do not sell this as protected access before that server policy is designed and tested.
5. Nearby and voice/video need supported real-device/network tests. Managed Chromium supplied no peer ICE candidates; no transport success is claimed.

## P2 — improvements and wider acceptance

- Large initial JavaScript remains roughly 276 KB Brotli; assess slower phone/network performance and split measured heavy paths.
- Rate limits are process local. Configure trusted proxy topology and shared/edge limits for any multi-instance deployment.
- JSON archive limits are 500 records/200 series; use verified durable hosted synchronization and backups for long-term history. Atomic rename is not a power-loss/fsync guarantee.
- Complete screen-reader/contrast/touch-device coverage, authenticated social browser journeys, hosted push, export/share behavior and browser compatibility.
- Define unanswered draw/resignation offer timeouts; current two-party offers can pause the match while awaiting a reply.
- Experimental Gemini training-lab strength, generated strategy claims and optional provider integrations are not certified. Never bundle private provider keys into VITE variables.

## P3 — maintenance

Maintain a single npm lockfile workflow, keep source inventory and operational runbooks current, and continue dependency scanning. Historical checkpoint evidence is retained with its original scope; it is not relabeled as a current production benchmark.
