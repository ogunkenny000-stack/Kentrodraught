# Tournaments and social audit

## Confirmed architecture

Tournament discovery reads `tournaments`; each tournament is one JSON-heavy document containing players, matches, rounds, logs and chat alongside prize money. Browser `TournamentDashboard.tsx` also contains legacy direct writes for management, chat, progression and results. Server admin routes create/delete tournaments and control prizes; `/api/coins/tournament-entry` derives the player identity from the verified token and invokes atomic registration/debit SQL.

Friends use a deterministic pair key and participant fields. Lounge and Friends screens subscribe to the same table. Private messages carry a deterministic chat ID plus sender/recipient identity; global chat uses an authenticated insert. Notification creation and push delivery run on the server, with notification subscriptions stored in Supabase.

## Repairs

The old tournament UPDATE policy allowed every authenticated user to replace any tournament document, including roster and outcomes. The final hardening policy makes writes service only; ordinary admins also use permission-gated server routes. The entry RPC's ambiguous column references are qualified, and duplicate registration/capacity/insufficient-funds checks remain transactional.

Friend writes can no longer impersonate either participant or create an immediately accepted relationship. Private-message writes bind the real sender and recipient to profile UUIDs, enforce the deterministic pair, and prevent later content/identity changes. Global-chat inserts validate the authenticated sender. Legacy rows are retained; missing UUID bindings are backfilled only from existing profiles, without replacing conflicting values.

## Remaining functional limits

The legacy browser tournament scheduler, chat and progression writes require dedicated validated server operations. They are blocked by the repaired policies rather than allowed to rewrite results or prizes. This repair does not claim a fully authoritative tournament engine, all formats/tie breaks, race-free round scheduling, or validated prize eligibility. Those need implementation and end-to-end staging tests before tournament production use.

Profile rating/progression fields are now protected against browser tampering. Trusted progression for every local/AI/tournament path is not implemented by this security change. Existing profile data is retained, but a browser upsert cannot serve as proof of a match outcome or paid unlock. Pending friendship request/accept UI must follow the new pending/recipient contract. Social identity checks and financial regressions run against a disposable database; actual Supabase Realtime delivery and multi-device behavior still require staging credentials and browser testing.
