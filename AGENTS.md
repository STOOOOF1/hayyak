# HAYYAK agent contract

These rules apply to every change in this repository unless the product owner explicitly approves a scope change.

1. Hayyak is primarily a voice queue/intercom for coffee shops. It is not an ordering product.
2. Simplicity is a product requirement. Prefer the smallest design that preserves correctness, safety, and tenant isolation.
3. Do not add restaurant features such as menus, products, orders, carts, payments, delivery, or loyalty.
4. Preserve complete multi-tenant isolation at the database, server, realtime, and voice-token boundaries.
5. Customers are anonymous. Customer registration, phone verification, and customer accounts are not required.
6. A vehicle is represented by one optional free-text `car_description` field, with a maximum length of 100 characters. Do not create structured vehicle data.
7. PostgreSQL database state is the source of truth for call and queue state. LiveKit is only the audio transport.
8. Enforce at the database/server level a maximum of one `ACTIVE` and one `ON_HOLD` call per branch. Never rely only on frontend checks.
9. Arabic RTL and a fast, mobile-first customer experience are priorities.
10. Per-branch QR codes and branch-aware PWA installation are core customer-entry capabilities.
11. PWA installation is optional and must never obscure, delay, or block the core call flow.
12. Do not expand product scope without explicit product-owner approval.

## Engineering guardrails

- Keep the business call states exactly: `WAITING`, `ACTIVE`, `ON_HOLD`, `ENDED`, `CANCELLED`.
- Preserve FIFO ordering for waiting calls.
- Put queue transitions in transactional database functions or equivalently atomic server-side transactions.
- Do not make WebRTC connection state change business state implicitly.
- Do not record voice or permanently retain customer coordinates.
- Treat `car_description` as untrusted text: validate length server-side and escape it on output.
- Public customer endpoints must be capability-scoped and must not expose a branch's full queue or another visitor's data.
- New tables, services, roles, and background jobs require a concrete MVP need.
- Read the files in `docs/` before implementing a phase. Stop at the boundary of the phase the product owner approved.

