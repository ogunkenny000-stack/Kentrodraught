-- Server-owned online results only. No historical ratings are recalculated.
begin;
alter table public.profiles add column if not exists "statsVersion" bigint not null default 0;
create table if not exists public.kentro_rated_matches (
  game_id text primary key, white_owner uuid not null, black_owner uuid not null,
  result jsonb not null, applied_at timestamptz not null default now()
);
alter table public.kentro_rated_matches enable row level security;
revoke all on public.kentro_rated_matches from public,anon,authenticated;

-- Moderation/admin rating changes must invalidate a concurrent rating snapshot.
create or replace function public.kentro_profile_stats_version()
returns trigger language plpgsql security invoker set search_path='' as $$ begin
  if row(new.elo,new.rd,new.vol,new.wins,new.losses,new.draws,new."gamesCount",new."totalPlayTime",new."averageDuration")
    is distinct from row(old.elo,old.rd,old.vol,old.wins,old.losses,old.draws,old."gamesCount",old."totalPlayTime",old."averageDuration")
  then new."statsVersion":=old."statsVersion"+1; end if;
  return new;
end $$;
drop trigger if exists kentro_profile_stats_version on public.profiles;
create trigger kentro_profile_stats_version before update on public.profiles
  for each row execute function public.kentro_profile_stats_version();

create or replace function public.kentro_apply_rated_result(
  p_game_id text,p_white_owner uuid,p_black_owner uuid,
  p_white_version bigint,p_black_version bigint,p_winner text,p_after jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_game public.completed_games%rowtype; v_white public.profiles%rowtype; v_black public.profiles%rowtype;
 v_result jsonb; v_duration numeric; v_rating jsonb; v_color text; v_owner uuid;
begin
 if p_game_id is null or p_white_owner is null or p_black_owner is null or p_white_owner=p_black_owner
   or p_white_version is null or p_black_version is null
   or p_winner is null or p_winner not in ('W','B','Draw') then raise exception 'Invalid rated participants'; end if;
 perform pg_advisory_xact_lock(hashtextextended('kentro-rating:'||p_game_id,0));
 select result into v_result from public.kentro_rated_matches
   where game_id=p_game_id and white_owner=p_white_owner and black_owner=p_black_owner;
 if found then return v_result; end if;
 select * into v_game from public.completed_games where "gameId"=p_game_id;
 if not found or v_game."playMode"<>'Multiplayer' or v_game.winner is distinct from p_winner
   or not (v_game."participantUserIds" ? p_white_owner::text and v_game."participantUserIds" ? p_black_owner::text)
 then raise exception 'No authoritative online result for these participants'; end if;
 -- Consistent row order prevents overlapping games from deadlocking.
 perform 1 from public.profiles where "ownerId" in (p_white_owner,p_black_owner) order by "usernameLower" for update;
 select * into strict v_white from public.profiles where "ownerId"=p_white_owner;
 select * into strict v_black from public.profiles where "ownerId"=p_black_owner;
 if v_white."usernameLower"<>lower(trim(v_game."whitePlayer"))
   or v_black."usernameLower"<>lower(trim(v_game."blackPlayer"))
   or v_white."usernameLower"='kentro_house' or v_black."usernameLower"='kentro_house'
 then raise exception 'Rated profile identity mismatch'; end if;
 if v_white."statsVersion"<>p_white_version or v_black."statsVersion"<>p_black_version
 then return jsonb_build_object('ok',false,'retry',true); end if;
 foreach v_color in array array['white','black'] loop
   v_rating:=p_after->v_color;
   if v_rating is null or jsonb_typeof(v_rating->'rating') is distinct from 'number'
     or jsonb_typeof(v_rating->'rd') is distinct from 'number' or jsonb_typeof(v_rating->'vol') is distinct from 'number'
     or not ((v_rating->>'rating')::numeric between 100 and 1000000)
     or not ((v_rating->>'rd')::numeric>0 and (v_rating->>'rd')::numeric<=10000)
     or not ((v_rating->>'vol')::numeric>0 and (v_rating->>'vol')::numeric<10)
   then raise exception 'Invalid Glicko result'; end if;
 end loop;
 v_duration:=greatest(1,least(604800,coalesce((v_game."moveEvaluations"->'__kentroGameRecord'->>'durationSeconds')::numeric,1)));
 update public.profiles set
   elo=round((p_after->'white'->>'rating')::numeric),rd=(p_after->'white'->>'rd')::numeric,vol=(p_after->'white'->>'vol')::numeric,
   wins=wins+case when p_winner='W' then 1 else 0 end,
   losses=losses+case when p_winner='B' then 1 else 0 end,
   draws=draws+case when p_winner='Draw' then 1 else 0 end,
   "gamesCount"="gamesCount"+1,"totalPlayTime"="totalPlayTime"+v_duration,
   "averageDuration"=round(("totalPlayTime"+v_duration)/("gamesCount"+1))
 where "usernameLower"=v_white."usernameLower" returning * into v_white;
 update public.profiles set
   elo=round((p_after->'black'->>'rating')::numeric),rd=(p_after->'black'->>'rd')::numeric,vol=(p_after->'black'->>'vol')::numeric,
   wins=wins+case when p_winner='B' then 1 else 0 end,
   losses=losses+case when p_winner='W' then 1 else 0 end,
   draws=draws+case when p_winner='Draw' then 1 else 0 end,
   "gamesCount"="gamesCount"+1,"totalPlayTime"="totalPlayTime"+v_duration,
   "averageDuration"=round(("totalPlayTime"+v_duration)/("gamesCount"+1))
 where "usernameLower"=v_black."usernameLower" returning * into v_black;
 v_result:=jsonb_build_object('ok',true,'white',jsonb_build_object('username',v_white.username,'rating',v_white.elo,'rd',v_white.rd,'vol',v_white.vol),
   'black',jsonb_build_object('username',v_black.username,'rating',v_black.elo,'rd',v_black.rd,'vol',v_black.vol));
 insert into public.kentro_rated_matches(game_id,white_owner,black_owner,result) values(p_game_id,p_white_owner,p_black_owner,v_result);
 return v_result;
end $$;
revoke all on function public.kentro_apply_rated_result(text,uuid,uuid,bigint,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.kentro_apply_rated_result(text,uuid,uuid,bigint,bigint,text,jsonb) to service_role;
commit;
