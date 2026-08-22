# S00 V4 Production Cutover

Date: 2026-08-21
Release: v1.0.0 AI baseline
Status: deployed and active

## Release summary

- Unified runtime Knowledge, operating rules and CRM field mappings.
- Upgraded production response generation to GPT-5.
- Answers every customer question before choosing one next action.
- Prevents repeated questions when valid customer information is already present.
- Preserves the existing WhatsApp entrypoint and current media/document handling.
- Supports all incoming customer numbers.
- Legacy AI remains disabled.
- Validated through compound-question, safety and anti-repeat UAT cases.

## Rollback

The previous production configuration remains recoverable through the automation platform's version history.
