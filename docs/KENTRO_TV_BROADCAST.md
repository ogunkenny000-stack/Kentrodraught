# Kentro TV broadcast upgrade — 20 October 2026 (Lagos)

## Viewing and learning

- A dedicated board-only public broadcast with player ratings when available, delayed clocks, series scores and arena spectator counts. TV viewers do not join the playing room; the arena spectator count is labelled accordingly and is not an invented TV audience count.
- The server captures sanitized public rooms every second and only publishes positions older than its delay. Default: 30 seconds. Set `KENTRO_TV_DELAY_SECONDS` to an integer from 15 to 300 and restart. A new game or server restart warms up for the full delay. Private/unstarted rooms are omitted. The TV board has no engine suggestions or live predictions.
- Replay controls: first/previous/play/pause/next/last, position slider, 0.25×–4× speed, and keyboard arrows/Home/End/Space outside form controls. Every replay move is checked against the unchanged Nigerian rules.
- Highlights include captures, king captures, promotions, observed sacrifice/capture sequences and final moves. A detected sequence is an observation from the recording, not a proof of a forced combination or engine-rated brilliance.
- Predict the next recorded move using the complete legal move list. Reveal compares with the actual recorded choice. It does not assert the best engine move or change ELO.
- Share the exact move or bounded clip through replay links, WhatsApp/native share, and the existing short-video export. Actual device share/recording support varies.
- Low-data mode persists on the device, slows board polling from 5 to 30 seconds and disables video export. It does not download a camera/video stream. Live clocks show the values at the sampled delayed position, rather than inventing a running authoritative clock between polls.

## Community and tournaments

- Follow registered players by username or from a broadcast card. Follows belong to verified Auth accounts and persist in Supabase. A public match generates a deduplicated `system` notification linking to its TV room. Existing Important updates preferences govern this category; background push still requires the hosting VAPID configuration and device permission. The server scans follows every 15 seconds in paginated batches.
- Public tournament broadcasts show standings, fixtures, results, active featured-room links and completed-game replay links. Private tournaments and those with spectator permission disabled are omitted. Standings are the tournament authority's stored points, not a separate TV ranking.
- Signed-in viewers can discuss public broadcasts. Locally mute an author, or report a broadcast/comment with a reason. Reports remain private to moderators. Restricted and temporarily muted accounts cannot post chat.
- `manage_announcements` grants approved commentary and up to six board arrows per post. The server derives author identity and caster status; body-supplied roles are ignored. Replay arrows return to the comment's recorded ply; live arrows are available only at the matching delayed ply.
- `manage_reports` grants the TV moderator queue, hide, resolve, or hide plus 24-hour account chat mute. Moderation is performed on the server. Viewer text is rendered as text, never HTML. Writes are rate limited; ordinary clients have no direct access to the four TV database tables.

## Deployment

The additive migration `supabase/migrations/20261020_kentro_tv.sql` was rehearsed locally, then installed on the original project `pwovowlyylceuzontdhg`. Four new tables have RLS enabled and direct anon/authenticated privileges revoked. No existing game, profile, wallet, rating or Auth rows were changed. Do not rerun the entire combined migration bundle on production for this feature. Other installations should apply just this new migration after their existing app schema.

Deploy this release's complete Node backend and rebuilt frontend to `kentrodraught.ai.studio`. Keep the existing original-project Supabase keys and persistent game-data volume. No hosting identity is connected in the coding environment, so publishing GitHub source and the ZIP does not update the live AI Studio deployment. Existing coin and push hosting configuration remains necessary; this feature does not secretly enable either.

Endpoints are under `/api/tv`: `live`, `me`, `follows`, `tournaments`, `feed/:gameCode`, `reports`, and `moderate`. Bearer or existing `x-access-token` authentication is required for account writes. The delayed in-memory buffer supports up to 100 public rooms per Node process. With multiple game servers, route TV requests to the room-owning process or add a shared broadcast service; an isolated process cannot display another process's room memory.

## Validation and limits

Automated coverage checks actual room privacy filtering, delay warmup/rematch reset, immutable delayed boards, authorization and identity binding, forged commentator roles, report scoping, moderation authority, and migration reruns/RLS privileges. The real Chromium TV journey covers desktop/mobile replay, clip bounds, speed, predictions, tournament-to-live navigation, low-data controls and approved arrow composition using explicit local API fixtures.

The hosted schema was checked, but authenticated live follows, live two-player clock transport, push delivery, human moderation and native share/video handoff still require acceptance after hosting deployment. A finite broadcast delay reduces immediate assistance; it cannot guarantee that no viewer shares information through other channels.
