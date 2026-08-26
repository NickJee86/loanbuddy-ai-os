# LoanBuddy AI OS

Production CRM and AI conversation control for LoanBuddy.

## WhatsApp console

The Conversations module combines inbound messages, outbound messages, documents and case events. Authorized CRM staff can pause AI for a customer, queue a manual WhatsApp message in `Message_Outbox`, and resume AI.

Required Vercel environment variables:

- `CRM_SESSION_SECRET`
- `CRM_USERS_JSON` (or CRM users stored in the workbook)
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_SHEET_ID`

Run `npm test` before release.

## Production release

Current production patch includes faster AI replies, LoanBuddy branch address knowledge, police-applicant rejection rules, CRM data refresh status, and visibility of unlinked WhatsApp customer activity for authorized operations roles.
