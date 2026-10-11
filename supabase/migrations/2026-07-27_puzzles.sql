-- Puzzles: admin-authored traps + tactics auto-mined from real completed
-- games (lidraughts-style). Solutions are ordered {from, to, text} steps in
-- Nigerian 1-50 numbering; fen is the engine's Scan FEN for the start
-- position (side to move = the solver).
create table if not exists puzzles (
  "id"             uuid primary key default gen_random_uuid(),
  "title"          text not null,
  "difficulty"     text not null default 'Medium',   -- Easy | Medium | Hard
  "theme"          text not null default 'Tactics',
  "description"    text not null default '',
  "fen"            text not null,
  "solution"       jsonb not null,                    -- [{from,to,text}, ...]
  "explanation"    text not null default '',
  "source"         text not null default 'admin',     -- 'admin' | 'game'
  "sourceGameId"   text,                              -- completed_games."gameId" when mined
  "createdBy"      text,
  "createdAt"      timestamptz not null default now()
);

create index if not exists puzzles_created_idx on puzzles ("createdAt" desc);
create index if not exists puzzles_source_game_idx on puzzles ("sourceGameId");

alter table puzzles enable row level security;

-- Everyone signed in can read puzzles; writes go through the server's
-- service-role key only (admin endpoints), same as coin settings.
create policy "puzzles_select_authenticated" on puzzles
  for select to authenticated using (true);
