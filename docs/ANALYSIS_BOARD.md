# Analysis board

Open **Analysis lab**, then **Explore a New Position**. The board fits the available space; replay controls remain reachable on smaller screens. Move pieces normally, use **Moves** for review, or **Setup** to load a position or open the editor. The editor's **Analyze position** button starts a new study with its chosen first mover.

**Engine** offers 1.5, 5 and 15 seconds per position. Analysis and practice run locally using the shipped C++ WebAssembly engine. Game review runs sequentially, reports actual progress and stops when its game or starting position changes. Initial offline use requires a completed online download. The mobile Lab is prepared by the service worker too.

Scores always use White's perspective, including historical and Black-first positions. A dash means no completed estimate is available. Failed searches offer Retry; they never become a fictitious draw. Actual terminal results use the shared game adjudicator. Material estimates and review percentages are heuristics, not win probabilities or guarantees. The engine’s top choice is not labelled a blunder merely because the next independent search changes its estimate.

**Starting position**, Previous, Next and Latest cover the whole replay, including the board before move 1. Keyboard arrows, Home and End navigate without intercepting text entry or modal controls. The best-move arrow refers to the displayed position, and Board options can hide it.

**Copy PDN / Export** retain a custom starting board and first mover. Import accepts Kentro's Nigerian notation, tags and comments, validates every move, and rejects unsupported variations. It uses the application's 51-character SCAN FEN; this is not a promise to parse every third-party PDN dialect.

Analysis studies do not record match results, award rewards or unlock ranked levels. Supabase bindings, financial protections and draughts rules remain unchanged. Tests improve confidence; no software or finite engine search can be guaranteed error-free or perfect.

Validation: `npm run lint`, `npm test`, `npm run build`; serve `dist` locally and run `CHROME_NO_SANDBOX=1 E2E_APP_URL=http://127.0.0.1:8136 npx tsx scripts/e2e/analysis.e2e.ts`. The browser journey blocks hosted traffic and checks actual engine execution, setup, replay, cancellation and mobile layout.
