# Knowledge Runtime Audit

Audit date: 2026-08-21

## Authoritative Notion sources

| Source | Data source | Total | Runtime-ready |
|---|---|---:|---:|
| LoanBuddy_Knowledge_Base | `collection://4252f627-9f2c-44e5-a628-28b21f17a6c7` | 118 | 115 Active |
| LoanBuddy_AI_Operating_Rules | `collection://498b52d2-4c5a-44d3-b3e2-a8953758826e` | 117 | 117 Active |
| LoanBuddy_AI_CRM_Field_Mapping | `collection://9f2f740c-4c4c-48f0-8145-4b3c6f4f0c9a` | 45 | 45 Active |
| LoanBuddy_AI_Regression_Tests | `collection://fddfc17d-4c00-49bb-a138-43630d5ee453` | 69 | 69 Ready / 0 Passed |

## Confirmed production defects

1. `KB02 — Notion → LoanBuddy Runtime Knowledge Sync` contains only one placeholder module.
2. KB02 runs every 15 minutes but completes with zero operations, so no Notion record is synchronized.
3. The inactive S00 V3 shadow flow retrieves only one `KB:<intent>` record and one `RULES:<stage>` record per turn.
4. One-intent retrieval cannot answer every question when a customer asks several unrelated questions in one message.
5. The shadow prompt contains stale policy:
   - says interest “starts from 1.5%” instead of fixed 1.5% per month;
   - asks for three months of payslips and a utility bill, conflicting with the current document policy.
6. Regression tests exist but none has a Passed result.

## Required release gates

- Replace KB02 placeholder with a real sync pipeline.
- Retrieve every relevant knowledge result for all questions in a turn.
- Apply active rules by priority: Guardrail/Critical, High, Normal.
- Enforce changed-fields-only and never-blank-existing CRM writes.
- Reject blank AI replies and duplicates before Message_Outbox.
- Pass all 69 Ready regression tests.
- Keep legacy S03 disabled during migration.
