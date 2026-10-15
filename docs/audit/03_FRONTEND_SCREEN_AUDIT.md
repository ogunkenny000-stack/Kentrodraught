# Frontend screen audit — 15 October 2026

The continuation preserves the owner's GitHub checkpoint and Royal Wood styling. React source, shared UI, account initialization, nearby lifecycle, replay and social paths were reviewed. Automated inventory identifies 69 component files; this is an inventory, not proof that every state of every screen was tested.

## Repairs

- Password recovery now has a completion form, validation, expired-session feedback and a success state that requires an actual successful Auth update. Recovery events are subscribed before asynchronous session restoration; late bootstrap work cannot overwrite a newer auth event.
- Nearby stays mounted during account restoration. Connection generations reject stale offer/answer completions and callbacks after reset. Navigation confirms leaving an active connection; unsolicited end/rematch replies cannot terminate/reset play.
- Replay and analysis respect custom starting positions and Black-first games. Invalid histories cannot produce fabricated analysis scores.
- Private tournament code entry calls the authenticated invitation endpoint. It no longer requires publicly downloading all private tournaments. Fictional AI entrants and unsupported shared-group creation are not presented as real persisted services.
- Direct-message conversation identities handle underscores. Rich messages are encoded into actual schema-supported fields, use UUIDs, and show failed sends. Friend acceptance is limited to the intended recipient and legacy pairs are matched by participants.
- Modal keyboard handling selects the visible topmost dialog. Focus restoration and React 19 types were corrected. Existing guest navigation gates remain enforced.

## Executed browser evidence

`CHROME_NO_SANDBOX=1 E2E_APP_URL=http://127.0.0.1:8126 npm run test:browser` passed against the built app: account input labels and validation, reset-request validation, guest navigation, native AI reply, resume without another trial, explicit New Game, exhausted quota, modal focus/Tab/Escape, reduced motion, and mobile account gates. Board reachability/overflow checks covered 320, 360, 375, 390, 414, 768, 1024 and 1440 widths plus 844×390 landscape. No uncaught UI exception occurred in the journey. Test controls now wait for moving drawer elements to become clickable; they retain the same product assertions.

`scripts/e2e/recovery.e2e.ts` separately passed minimum-length/matching validation, expired session rejection, a successful explicit in-browser Auth response fixture and continuation. No hosted password was changed. TV and offline results are detailed in reports 10 and 11. Browser PvP passed real local socket moves, clocks, reconnect, resignation and rematch; voice was explicitly skipped.

## Limits

Hosted registration, email confirmation/recovery delivery, authenticated profile/wallet/social Realtime and actual private tournament redemption still require staging credentials and installed SQL. UI fixtures are identified as fixtures. Full screen-reader, contrast, touch-device, Safari and Android hardware acceptance has not been established. The large initial bundle and the incomplete tournament/group backend remain material limitations.


## Completion journeys

The actual lounge now exposes persistent group creation, consent-based invitations,
member messaging, owner/admin controls and visible backend errors. The creation
dialog uses the shared focus-trapping shell and labeled inputs; conversation rows
are keyboard-operable. A two-browser PostgreSQL-backed fixture verifies persistence
and consent, while explicitly excluding hosted Auth/PostgREST/Realtime claims.
Small attachments are bounded and recording tracks stop on chat change/unmount.
Tournament start/join/watch now use server pairings and real multiplayer rooms;
client-generated official results and local fallback tournaments were removed.
Unanswered draw/resignation dialogs expire after 30 seconds. Missing call routing
cannot show a simulated connected call. See reports 12–14 for exact limits.
