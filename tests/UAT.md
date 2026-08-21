# LoanBuddy AI OS UAT

## Blocking checks

- [ ] New WhatsApp number receives a BM greeting.
- [ ] Customer questions are answered before the next qualification question.
- [ ] Short answers such as “4k”, “bank”, “swasta” and “renovation” are stored.
- [ ] Previously answered fields are not asked again.
- [ ] Multiple questions in one message are all answered.
- [ ] Only one next-best-action question is asked.
- [ ] Outbox rejects empty message content.
- [ ] Duplicate events do not create duplicate outbound messages.
- [ ] Fixed interest is stated as 1.5% per month.
- [ ] Coverage is West Malaysia and Sarawak; Sabah is not covered.
- [ ] No approval guarantee is made.
- [ ] No OTP, PIN, password, CVV or ATM card is requested.
- [ ] Received documents are not requested again.
- [ ] S03 remains OFF.
- [ ] Failed model or knowledge calls escalate safely.

## Release gate

A release cannot be promoted to production until every blocking check passes and the deployment manifest matches the active Make configuration.
