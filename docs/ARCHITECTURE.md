# LoanBuddy CRM AI OS Architecture

Version: 1.0.0
Baseline date: 2026-08-21
Owner: Rex Management / LoanBuddy

## Production flow

WhatsApp webhook -> S00 inbound gateway -> Customer_Inbox -> S01B lead capture -> Leads -> S02B new-AI welcome bridge -> Message_Outbox -> S00B WhatsApp sender.

Conversation state is stored in `Conversation_State`. Business facts come from `BUSINESS_RULES` and retrieved knowledge only.

## Scenario ownership

| Scenario | Responsibility | Baseline state |
|---|---|---|
| S00 | WhatsApp inbound gateway and routing | ON |
| S00B | Message_Outbox sender | ON |
| S01B | WhatsApp lead creation | ON, every 1 minute |
| S02B | New AI welcome bridge | ON, every 1 minute |
| S03 | Legacy AI | OFF (production lock) |

## Production safeguards

- Never enable S03 while the replacement AI route is active.
- Never deploy model IDs without a smoke test.
- Reject blank AI output before writing a Pending outbox record.
- Every outbound message requires a non-empty body and idempotency key.
- Do not change JomKaki scenarios or repositories.
- Secrets, tokens, customer records and identity documents must never be committed.
