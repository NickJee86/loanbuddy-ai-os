# Make production blueprints

This directory versions the Make.com scenarios that are part of the LoanBuddy AI runtime.

## Current production snapshot

| Scenario | Make scenario ID | Blueprint | Exported |
| --- | ---: | --- | --- |
| S00 V4 — Unified Knowledge AI Production | 6496076 | `blueprints/s00-v4-unified-knowledge-ai-production.blueprint.json` | 2026-08-26 |
| KB02 — Notion → LoanBuddy Runtime Knowledge Sync | 6954327 | `blueprints/kb02-notion-runtime-knowledge-sync.blueprint.json` | 2026-08-26 |

S00 V4 contains the production answer guardrails and reads approved customer-facing knowledge from `LoanBuddy_KB_Runtime_V2`. KB02 synchronizes approved Notion knowledge into that runtime data store.

The S00 production guardrails treat police applicants as not eligible for LoanBuddy. The reply must stop qualification and document collection instead of falling back to general lending assumptions.

Runtime-only production changes are recorded under `runtime-hotfixes/`. These manifests document the exact Make and Data Store changes that must be preserved in the next exported blueprint.

Blueprints do not contain live credentials. After importing, reconnect the approved Make connections and verify all mapped data stores, webhooks, and schedules before activation.

## Release procedure

1. Export the changed scenario from Make after saving it.
2. Replace the matching blueprint in this directory; never rename the production scenario.
3. Review the diff for unintended module, route, filter, prompt, connection, or schedule changes.
4. Run the CRM test suite and the controlled Make test case.
5. Commit the blueprint and related application changes together.
6. Activate or deploy only after the controlled test passes.
