# Tournaments and social workflows — 15 October 2026

An authoritative tournament worker and persistent group backend now replace the
unfinished/browser-only paths. Local unit, PostgreSQL, WebSocket and browser
integration evidence is recorded in [report 13](13_TEST_RESULTS.md). Real hosted
Supabase acceptance is PENDING; no production tournament or payment was run.

## Tournament authority

The organizer starts an event through an authenticated admin API. The server
validates actual registrations, computes pairings, commits versioned state with
compare-and-swap and provisions real multiplayer rooms. Only the paired Auth
UIDs may join through the hosted route. The browser cannot submit winners,
advance rounds, create fallback local events or inject fictional AI entrants.
Canonical room completions drive results, standings and the next round. Public
permitted boards can be watched; private/spectator-disabled rooms stay private.

A checksummed, fsynced local outbox persists tournament results before attempting
hosted synchronization. CAS retries preserve concurrent different-game results.
Duplicate terminal events are idempotent; participant/result conflicts remain in
the outbox for review and cannot silently rewrite a result. One failed event does
not prevent other events/events' room provisioning. The worker polls every ten
seconds when configured and scans all active pages. It is a single-writer design.

| Displayed format | Implemented server behavior |
| --- | --- |
| Swiss | Points/Buchholz/rating ordering, prefers unplayed opponents, balances color and rotates lowest-used byes |
| Arena | Clock-required Swiss rounds during a bounded 5–240 minute event, completes after current games finish |
| Single Elimination / Knockout Cup | One decisive loss eliminates; drawn games replay with swapped colors |
| Double Elimination | Two decisive losses eliminate; pairs matching loss counts where possible, including a final reset if needed |
| Round Robin / League | Circle schedule, one pairing per unordered opponent pair; odd rosters get one bye per player |
| Team | Cross-team board games; team totals determine champions, unmatched players sit without free points |
| Group Stage + Knockout | Two round-robin pools, top two per pool qualify, separate final-bracket losses preserve group statistics |
| King of the Hill | Winner stays, least-used challenger rotates, draws retain the reigning player, final king is champion |
| Robin Hood / Custom | Configurable Swiss with the supported handicap, clock and round settings; arbitrary custom tournament rules are not implied |

Elimination draws never manufacture a winner. Uneven group sizes do not repeat
finished pool pairings. Unclaimed pairings wait for the first competitor; the
absent opponent then gets 120 seconds. Both absent players produce no fictional
winner; a replacement drawn elimination pairing waits for a real participant.
An event with unclaimed games can require organizer cancellation/refund rather
than an invented champion. Existing in-flight ordinary games must be finished
or explicitly left before claiming another seat.

Prize payment remains an explicit organizer operation. New runtime events use
canonical champions, verified entry funding, integer shares/remainders, house
rake, row locks and a one-time paid marker. A failed later beneficiary rolls back
all credits. Sponsorship/manual unfunded pool increases are rejected. Legacy
pre-runtime events retain a separate compatibility path and require manual
reconciliation before any paid release. No real money-like balance was changed.

## Persistent groups

`kentro_groups`, `kentro_group_members` and `kentro_group_messages` store shared
state. Security-definer RPCs derive the actual user from `auth.uid()` and enforce
active-account, membership and owner/admin permissions under row locks. Table
writes from browsers are revoked; SELECT RLS excludes outsiders and removed
users. An invitation permits metadata visibility but messages require acceptance.
Owners transfer ownership or delete the group before leaving; admins cannot
remove/demote the owner or promote other admins independently.

Creation and message UUIDs are idempotent across lost responses. Initial invite
retry retains the creation identity instead of generating another group.
Messages bind the canonical sender, preserve rich payloads, support reactions
and authorized soft deletion. Limits bound owned groups, membership, message
length, message frequency and distinct reaction types. Polling (5-second lists,
2.5-second active feed) works without Realtime; actual hosted events are pending.
Read receipts and browser-local blocking/report drafts are not shared moderation
or proof that another participant read a message. The active feed displays the
latest 100 messages; older-page browsing and large object storage are future scope.

The two-browser regression renders the real lounge with the real Supabase SDK
against a clearly labeled local Auth/HTTP adapter and actual PostgreSQL RPCs/RLS.
It verifies creation, invite/accept, canonical messaging, reload persistence,
oversized attachment rejection and microphone cleanup when changing chats. It
is not evidence that hosted Auth, PostgREST or Realtime passed.

## Friends and notifications

Existing recipient-bound friend consent, immutable DM participants/content,
canonical global-chat senders and recipient-only notifications remain protected.
Notification owners may update read status only. Genuine signup/recovery,
Realtime, push delivery and target-device behavior remain staging acceptance.
See [Supabase handoff](../SUPABASE_HANDOFF.md) for migrations and exact next steps.
