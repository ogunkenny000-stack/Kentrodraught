# Keep the existing Supabase project and keys

Target: pwovowlyylceuzontdhg (the original project used by https://kentrodraught.ai.studio). This package replaces the earlier new-project ZIP for a key-preserving rollout.

Keep SUPABASE_URL, SUPABASE_SECRET_KEY, VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY unchanged in hosting. These assets were rebuilt using the original configured public URL/key. Set KENTRO_COINS_ENABLED=1, VITE_KENTRO_COINS_ENABLED=1, SKIP_DB_MIGRATION=1 and APP_URL=https://kentrodraught.ai.studio. No secret values are included in this ZIP. Source code and draughts rules are unchanged from the uploaded app.

Required order: deploy this updated backend/frontend first. Its financial readiness gate has been tested against the original database: it disables money routes until required database safeguards are installed. Verify the deployed assets/backend and disabled money state before upgrading the live database. Reconcile the snapshot against current data, then apply compatible reviewed migrations with the original account/wallet/ledger data preserved, and restart/redeploy so the startup readiness check can enable money. The original database upgrade has NOT been performed by preparing this ZIP.

Supabase project IDs and keys cannot be interchanged between projects. This approach upgrades the existing project in place. The second project and encrypted application backup remain recovery/testing resources; no live data has been replaced or overwritten. The original duplicate guest profile still needs the previously reviewed identity cleanup as part of an approved live migration. Do not run schema.sql, reset scripts, or all_migrations_combined.sql blindly on the live database.

The existing public site's legacy backend reports coinsEnabled=true even though the original DB lacks the new readiness and charge-receipt functions. Do not upgrade that active legacy backend by SQL alone. Hosting administration is not connected in this cloud session, so deployment is a prerequisite before live DB changes can continue.
