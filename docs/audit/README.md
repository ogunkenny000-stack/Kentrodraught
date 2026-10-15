# Kentro Draughts engineering audit

Current completion: **local development and staging integration verified within
the recorded scope; production acceptance PENDING.** Start with
[test results](13_TEST_RESULTS.md), [remaining constraints](14_REMAINING_ISSUES.md),
[assessment](16_FINAL_ENGINEERING_ASSESSMENT.md) and the
[Supabase handoff](../SUPABASE_HANDOFF.md).

The 01–16 reports cover architecture, build, frontend, rules, multiplayer,
security, database, performance, AI, Nearby, TV/notifications, tournaments/social,
verification, remaining work, operations and assessment. The historical
`AUDIT_CHECKPOINT_2026-10-15.md`, `CHECKPOINT_VALIDATION.md` and older `final-*`
evidence retain their original scope. Current `completion-*` evidence supersedes
old claims that live recovery, server tournament authority, persistent groups or
API AI entitlement are still unimplemented.

Source is saved on `codex-audit-recovery-20261014`. Use that branch's Code →
Download ZIP or an exact commit archive, not main's older snapshot. GitHub
source remains available after workspace reset; temporary workspace attachment
links are not the delivery mechanism. Private repositories need normal GitHub login.

No production database/infrastructure was changed. Disposable local PostgreSQL
roles/claims and local HTTP fixtures are not hosted Supabase acceptance.
