# Kentro Draughts audit

Current continuation: **READY ONLY FOR STAGING**, score **77/100**. Start with [test results](13_TEST_RESULTS.md), [remaining issues](14_REMAINING_ISSUES.md) and [assessment](16_FINAL_ENGINEERING_ASSESSMENT.md).

The numbered 01–16 reports cover architecture, build, frontend, rules, multiplayer, security, database, performance, AI, Nearby, TV/notifications, social/tournaments, verification, remaining work, deployment and assessment. `AUDIT_CHECKPOINT_2026-10-15.md` and `CHECKPOINT_VALIDATION.md` describe the earlier paused checkpoint; their results remain historical.

Source is saved on GitHub branch `codex-audit-recovery-20261014`. Download it through GitHub's Code → Download ZIP or a commit archive. This survives workspace resets; a local workspace file link is not the delivery mechanism. Private repositories require the owner's normal GitHub login.

No production database or deployment was changed. Local roles and transactions were tested on disposable PostgreSQL only. Review the staging requirements before activating privileged features.
