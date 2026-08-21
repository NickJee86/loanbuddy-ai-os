# Changelog

## [1.0.0] - 2026-08-21

### Fixed

- Replaced deprecated `gpt-5-chat-latest` with `gpt-5` in S02B.
- Increased max output tokens from 300 to 1000 to prevent blank replies.
- Removed the conflicting welcome filter that rejected leads marked `LeadCreated`.
- Reset the S01B/S02B watch cursor for clean CRM retesting.
- Quarantined the blank Pending outbox record as `Skipped`.
- Confirmed a non-empty WhatsApp welcome message reached `Sent`.

### Operations

- Enabled S02B every minute as the new AI welcome bridge.
- Kept legacy S03 disabled.
- Established GitHub as the system-of-record for future AI OS releases.
