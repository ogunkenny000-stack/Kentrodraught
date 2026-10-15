# Remaining issues — 15 October 2026

Readiness: **READY FOR LOCAL DEVELOPMENT AND STAGING INTEGRATION. PRODUCTION
ACCEPTANCE PENDING.** No hosted Supabase or production infrastructure was changed.
The original gaps in live restart recovery, tournament authority, persistent
groups and API-level AI access have source repairs and local regression evidence.
This does not establish that every application path or deployment is perfect.

## Release gates requiring external integration

1. **PENDING — hosted Supabase.** Rehearse ordered migrations on a copy of the
   real schema/data; test genuine Auth/reset email/JWT revocation, PostgREST/RLS,
   Realtime, private tournament access, group membership removal, canonical ratings
   and persisted results. `npm run test:hosted` is opt-in and exits 2 without explicit
   disposable staging bindings. Local role claims/HTTP adapters are fixtures.
2. **PENDING — device media/Nearby.** Managed Chromium produces no peer ICE
   candidates. Verify voice/video/screen share and Nearby on real devices and
   separate NAT/mobile networks with the operator's own TURN REST relay and HTTPS.
3. **PENDING — release operations.** Rehearse deployment/rollback, consistent
   data-volume backups/restoration, genuine hosted push and realistic capacity.
   Reconcile historical wallets, legacy tournament payouts and ledger anomalies
   before enabling paid events. No production payment/withdrawal test was run.

## Operating constraints and wider product work

- Exactly one Node authority per persistent data directory. JSON files and
  process-local rate limits do not support horizontal replicas/distributed rooms.
  Shared routing/storage/limits require a different architecture before scaling.
- Active snapshots fsync before acknowledgement; clock checkpoints are one second
  apart. An abrupt crash can restore roughly one second of clock time; outage time
  is frozen. This is an explicit recovery policy, not zero-loss distributed failover.
- Room/outbox files contain resume tokens and need private filesystem/backups.
  Corruption fails startup; restore a verified compatible backup. Archives retain
  500 games/200 series locally; long-term history needs verified hosted sync.
- Tournament formats and deterministic tie breakers are described in report 12.
  This is not federation bracket certification. Unclaimed matches need players
  or organizer cancellation/refund; no-show events do not invent champions.
  Sponsored prize funding and arbitrary custom rules are not supported.
- Group feeds show the latest 100 messages. Larger media storage, historical feed
  pagination, shared read receipts and server moderation/report workflows remain
  product extensions. Inline attachments are bounded at 120 KB; oversize files
  show an error. Local block/report drafts do not affect other accounts.
- The main browser entry remains large; measure slow phones/networks before
  choosing further code splits. Complete screen-reader, contrast, touch and target
  browser/device acceptance. Current responsive/focus tests have bounded scope.
- Draw/resignation offers now expire after 30 seconds and resume clocks; the
  existing two-party resignation design is preserved. Review repeated-offer policy
  for competitive operation; this work does not change Nigerian Draughts rules.
- Experimental Gemini training-lab/provider claims are not strength certification.
  Browser AI analysis is limited by canonical access; provider keys stay private.

No unresolved P0 was reproduced in the final executed local suites. This is
bounded evidence; the actual production schema, users and infrastructure were
not inspected. See [handoff](../SUPABASE_HANDOFF.md) and report 13 for executed
versus pending checks.
