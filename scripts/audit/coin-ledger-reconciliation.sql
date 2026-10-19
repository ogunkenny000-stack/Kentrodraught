-- READ ONLY. Run after applying staged Kentro SQL migrations.
-- Review anomalies manually; NEVER issue automatic refunds or payouts from
-- a diagnostic query. Escrowed wagers need the canonical server game result.
with entries as (
 select "refId" as game_id, lower(username) as username,
        count(*) as debit_count, sum(amount) as debit_amount
 from public.coin_transactions
 where type='match_entry' and direction='debit' and "refId" is not null
 group by "refId",lower(username)
), totals as (
 select game_id,count(*) players_charged,sum(debit_count) entry_ledger_rows,
        min(debit_amount) smallest_paid, max(debit_amount) largest_paid
 from entries group by game_id
)
select t.game_id, t.players_charged, t.entry_ledger_rows,
       t.smallest_paid, t.largest_paid,
       case when t.players_charged<>2 then 'PLAYER_COUNT_MISMATCH'
            when t.entry_ledger_rows<>2 then 'DUPLICATE_OR_PARTIAL_CHARGE'
            when t.smallest_paid<>t.largest_paid then 'UNEQUAL_ENTRIES'
            when s.match_id is null then 'UNSETTLED_REQUIRES_GAME_RESULT'
            else 'SETTLED' end as review_status
from totals t left join public.kentro_match_settlements s on s.match_id=t.game_id
where t.players_charged<>2 or t.entry_ledger_rows<>2
   or t.smallest_paid<>t.largest_paid or s.match_id is null
order by review_status,t.game_id;
