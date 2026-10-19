-- Execute in Supabase SQL Editor AFTER manual_live_finance_20261017.sql.
-- Every synthetic financial write lives in a PL/pgSQL exception subtransaction
-- that is forcibly rolled back. No test coins, wallets or receipts persist.
DO $kentro_probe$
DECLARE
  v_nonce text := substr(md5(clock_timestamp()::text || random()::text),1,20);
  v_white text;
  v_black text;
  v_game1 text;
  v_game2 text;
  v_game3 text;
  v_game4 text;
  v_rejected boolean;
  v_response jsonb;
  v_cash numeric;
  v_count integer;
BEGIN
  v_white := '__kentro_probe_' || v_nonce || '_w';
  v_black := '__kentro_probe_' || v_nonce || '_b';
  v_game1 := '__kentro_probe_match_' || v_nonce || '_win';
  v_game2 := '__kentro_probe_match_' || v_nonce || '_refund';
  v_game3 := '__kentro_probe_match_' || v_nonce || '_draw';
  v_game4 := '__kentro_probe_match_' || v_nonce || '_cancel_first';
  BEGIN
    PERFORM public.credit_wallet(v_white,100,'admin_adjustment','__kentro_test');
    PERFORM public.credit_wallet(v_black,100,'admin_adjustment','__kentro_test');
    v_response:=public.kentro_charge_match_pot(v_game1,v_white,v_black,30);
    IF (v_response->>'ok')::boolean IS DISTINCT FROM true OR
       (v_response->>'alreadyCharged')::boolean IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'Initial escrow charge failed %',v_response;
    END IF;
    SELECT balance INTO v_cash FROM public.coin_wallets WHERE username=v_white;
    IF v_cash<>70 THEN RAISE EXCEPTION 'White charged unexpected amount %',v_cash; END IF;
    SELECT balance INTO v_cash FROM public.coin_wallets WHERE username=v_black;
    IF v_cash<>70 THEN RAISE EXCEPTION 'Black charged unexpected amount %',v_cash; END IF;
    v_response:=public.kentro_charge_match_pot(v_game1,v_white,v_black,30);
    IF (v_response->>'alreadyCharged')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Duplicate charge was not deduplicated %',v_response;
    END IF;
    SELECT count(*) INTO v_count FROM public.coin_transactions WHERE "refId"=v_game1 AND type='match_entry';
    IF v_count<>2 THEN RAISE EXCEPTION 'Expected exactly two debits, got %',v_count; END IF;
    v_response:=public.kentro_settle_match_pot(v_game1,v_white,v_black,30,v_white,false,0.1);
    IF v_response->>'payout'<>'54' OR v_response->>'rake'<>'6' THEN
      RAISE EXCEPTION 'Incorrect payout/rake %',v_response;
    END IF;
    SELECT balance INTO v_cash FROM public.coin_wallets WHERE username=v_white;
    IF v_cash<>124 THEN RAISE EXCEPTION 'Wrong winner balance %',v_cash; END IF;
    v_response:=public.kentro_settle_match_pot(v_game1,v_white,v_black,30,v_white,false,0.1);
    SELECT count(*) INTO v_count FROM public.coin_transactions WHERE "refId"=v_game1 AND type='match_prize';
    IF v_count<>1 THEN RAISE EXCEPTION 'Duplicate settlement credited winner twice'; END IF;
    v_response:=public.kentro_charge_match_pot(v_game2,v_white,v_black,20);
    IF (v_response->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Second charge failed'; END IF;
    v_response:=public.kentro_refund_unstarted_match(v_game2,v_white,v_black,20);
    IF (v_response->>'refunded')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Aborted game refund failed %',v_response;
    END IF;
    SELECT balance INTO v_cash FROM public.coin_wallets WHERE username=v_white;
    IF v_cash<>124 THEN RAISE EXCEPTION 'White refund incorrect %',v_cash; END IF;
    SELECT balance INTO v_cash FROM public.coin_wallets WHERE username=v_black;
    IF v_cash<>70 THEN RAISE EXCEPTION 'Black refund incorrect %',v_cash; END IF;
    v_response:=public.kentro_refund_unstarted_match(v_game2,v_white,v_black,20);
    IF (v_response->>'alreadySettled')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Second refund not deduplicated %',v_response;
    END IF;
    v_rejected := false;
    BEGIN
      v_response:=public.kentro_charge_match_pot(v_game2,v_white,v_black,20);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'Match payment already settled; a new game must use a new ID' THEN RAISE; END IF;
      v_rejected := true;
    END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'Previously refunded receipt was reused'; END IF;

    v_response:=public.kentro_charge_match_pot(v_game3,v_white,v_black,20);
    IF (v_response->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Draw charge failed'; END IF;
    v_response:=public.kentro_settle_match_pot(v_game3,v_white,v_black,20,null,true,0.1);
    IF (v_response->>'payout')::numeric IS DISTINCT FROM 40 OR
       (v_response->>'rake')::numeric IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Draw refund incorrect'; END IF;
    PERFORM public.kentro_settle_match_pot(v_game3,v_white,v_black,20,null,true,0.1);
    SELECT count(*) INTO v_count FROM public.coin_transactions WHERE "refId"=v_game3 AND type='refund';
    IF v_count<>2 THEN RAISE EXCEPTION 'Draw refund repeated'; END IF;

    -- Cancellation can reach PostgreSQL before a delayed charge request.
    -- A durable tombstone must prevent that future charge from taking coins.
    v_response:=public.kentro_refund_unstarted_match(v_game4,v_white,v_black,20);
    IF (v_response->>'notCharged')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Uncharged cancellation failed'; END IF;
    v_rejected := false;
    BEGIN
      PERFORM public.kentro_charge_match_pot(v_game4,v_white,v_black,20);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'Match payment already settled; a new game must use a new ID' THEN RAISE; END IF;
      v_rejected := true;
    END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'Cancelled match accepted a late charge'; END IF;
    -- This deliberate error aborts the subtransaction; no durable test data.
    RAISE EXCEPTION 'KENTRO_PROBE_INTENTIONAL_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'KENTRO_PROBE_INTENTIONAL_ROLLBACK' THEN
      RAISE;
    END IF;
  END;
  SELECT count(*) INTO v_count FROM public.coin_wallets
    WHERE username IN (v_white,v_black);
  IF v_count<>0 THEN RAISE EXCEPTION 'Probe data survived rollback'; END IF;
  SELECT count(*) INTO v_count FROM public.coin_transactions
    WHERE username IN (v_white,v_black) OR "refId" IN
      (v_game1,v_game2,v_game3,v_game4,'rake:'||v_game1,'rake:'||v_game3);
  IF v_count<>0 THEN RAISE EXCEPTION 'Probe ledger rows survived rollback'; END IF;
  SELECT count(*) INTO v_count FROM public.kentro_match_charges WHERE match_id IN (v_game1,v_game2,v_game3,v_game4);
  IF v_count<>0 THEN RAISE EXCEPTION 'Probe charge receipts survived rollback'; END IF;
  SELECT count(*) INTO v_count FROM public.kentro_match_settlements WHERE match_id IN (v_game1,v_game2,v_game3,v_game4);
  IF v_count<>0 THEN RAISE EXCEPTION 'Probe settlements survived rollback'; END IF;
  RAISE NOTICE 'PASS: Charge, idempotency, settlement, rake, draw, abort, late-charge cancellation, and zero persisted synthetic rows.';
END $kentro_probe$;

-- Confirm privileges and real financial readiness without modifying balances.
SELECT public.kentro_coin_readiness() AS readiness,
       has_function_privilege('anon','public.kentro_charge_match_pot(text,text,text,numeric)','EXECUTE') AS charge_exposed_to_anon,
       has_function_privilege('authenticated','public.kentro_charge_match_pot(text,text,text,numeric)','EXECUTE') AS charge_exposed_to_players,
       (SELECT count(*) FROM public.kentro_match_charges) AS real_match_receipt_count;
