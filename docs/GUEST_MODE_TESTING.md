# Guest Mode — release checklist

No redesign: Continue as Guest lives on the existing sign-in screen, and a compact trial banner appears after entry.

## Prerequisites

1. In production, run `supabase/guest_trials.sql` in the target Supabase project SQL Editor. Use the deployed server's `SUPABASE_URL` and private `SUPABASE_SECRET_KEY` environment variables. NEVER put the secret in `VITE_*` or client JavaScript.
2. Deploy both the updated frontend and game server at the same time. If there is no Supabase configuration, quota persistence is only per-process for development.
3. On a staging URL, clear *only your staging site* data for a new guest identity.

## Device acceptance checks

- [ ] Fresh browser: click **Continue as Guest**. No email, password or registration should be needed.
- [ ] Browse the home page, menu and free features. Ranked progression, wallet, tournaments and account-only features ask for sign-in, not fail silently.
- [ ] Enter AI play and start a game. Banner changes AI remaining from 3 to 2. Continue after navigating away or refresh; resuming the same match should not use another trial.
- [ ] Start a second and third AI game and verify the remaining counts (1, then 0). Attempt a fourth and confirm a clear sign-in prompt.
- [ ] Host a free, single-game online match as a guest, using a second signed-in browser/device to join. Both can play legally without a guest login.
- [ ] Verify creating a room *without starting a game* does not use the online trial.
- [ ] Once the two players' game starts, refresh/reconnect the guest and verify they can continue the same match without an extra allowance.
- [ ] After ending the online match, guest cannot start another room, join another room, reset or request rematch; a sign-in prompt appears.
- [ ] Verify room code and WhatsApp direct invitation continue to work with guest sign-in bypass.
- [ ] Sign in as a normal user and confirm standard unlimited AI/online flows, ratings, coins, game history and rooms behave as before.
- [ ] Attempt a free multiplayer match in a second browser tab and while the guest quota is exhausted; no extra online game should be authorized.
- [ ] Temporarily make the production guest SQL RPC unavailable; online guest admission must fail closed with a friendly error, not grant another game.

## Known scope

The AI trial count uses persistent browser localStorage; users can reset it by erasing site data or using another device. The anonymous online identifier is server-quota-limited for that guest identity; anonymous identities are not a foolproof per-human anti-abuse limit. If the product needs strict one-trial-per-person enforcement across devices, require account/device verification at the policy boundary.

Full app build and live two-device acceptance tests must be executed after installing dependencies in a network-enabled environment.
