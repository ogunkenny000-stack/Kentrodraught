# Tournaments and social workflows — 15 October 2026

Tournament access and money-like operations have concrete authorization and
transactional tests. A complete authoritative tournament scheduling, pairing,
live-board and standings pipeline is still unfinished. Do not present this
component as a certified tournament platform or enable browser-generated
official results as a substitute.

## Tournament changes and tests

Private tournament rows and invitation codes were previously readable by
everyone. A new SQL policy limits access to active registered players,
authorized admins and UID-bound invited viewers. The server invitation endpoint
redeems codes on behalf of its verified caller, limits attempts and returns an
authorized row without publicly listing private events. Private entry checks
the stored invitation in the same transactional RPC that charges the fee and
updates the roster. Private chat checks access independently. New private
codes contain 96 random bits; legacy codes remain usable unless ambiguous.

The server's admin creation route no longer injects a fictional Ken 5 entrant
with invented ratings. There is no implemented authoritative AI tournament
worker to substantiate that competitor. Human participants are added by the
entry RPC, and tournament IDs use random UUIDs.

Disposable PostgreSQL checks execute private SELECT restrictions, invitation
role and UID binding, missing/closed invitation errors, ban revocation,
unauthorized chat/entry, canonical entrant names, and failure without a wallet
debit. Additional concurrent tests race the last registration slot, repeated
entry, payout and cancellation refunds. The complete database run passes
26 checks; this count includes other database domains and is not 26 tournament
browser journeys. Invitation HTTP fixtures are part of the 71-test focused
security run. Genuine authenticated browser/Supabase tournament flow remains
staging work.

## Friends, messaging and notifications

Friend records bind both real profiles and the sender. Only the intended
recipient may change a pending request to accepted; participants cannot be
rewritten. Unrelated users cannot read or delete the friendship. Private message
inserts require the verified sender and the actual recipient owner UID. Message
participants and content are immutable; allowed status/reaction changes do not
grant the ability to rewrite text or sender. Global chat sends require canonical
account ownership. Active account policies block banned direct browser writes.
These boundaries were exercised with actual PostgreSQL roles.

Notification inbox rows are recipient-only. This continuation narrows UPDATE
privileges explicitly to `read_at`, preventing owner edits to canonical
notification contents under broad default grants. Push subscription keys and
destinations have local validation tests. Real VAPID delivery, hosted Realtime
events and multi-device social journeys were not established by the local SQL
or HTTP fixtures. Refer to the frontend report for the current UI behavior;
source review of one layer does not certify the full hosted workflow.

Group creation/chat/roles do not have a complete persisted group backend in
this snapshot. UI features with no authoritative implementation must remain
clearly unavailable. Paid tournaments require the broader deployment and
financial review described in the database report; no real payment or prize
transfer was attempted.
