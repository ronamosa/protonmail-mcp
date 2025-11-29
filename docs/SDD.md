# Protonmail MCP Hardening SDD

## 1. Overview
This document tracks the scoped hardening effort for the Protonmail MCP server. The goal is to ship pragmatic, non-enterprise improvements that make the server safer and more reliable for local use.

## 2. Goals & Non-Goals
- **Goals**
  - Validate tool inputs with clear error messages.
  - Improve SMTP transport safety (TLS defaults, timeouts).
  - Keep the server resilient to transient SMTP failures.
  - Offer minimal operational insight (health check, logging).
  - Provide lightweight abuse guards (rate limit, allow list).
- **Non-Goals**
  - Multi-tenant controls or persistent storage.
  - Enterprise-grade observability stacks.

## 3. Requirements
| ID | Requirement | Notes |
| --- | --- | --- |
| R1 | Reject malformed tool inputs with schema validation | Helps prevent header injection |
| R2 | Support secure SMTP defaults and configurable timeouts | Ensure TLS >= 1.2 and configurable |
| R3 | Server must stay up on send failures | Convert transport errors into MCP responses |
| R4 | Provide `health_check` tool | Quick diagnostics for clients |
| R5 | Rate limit sends per minute and optional recipient allow list | In-memory implementation is enough |
| R6 | Document configuration and workflow | README + changelog |

## 4. High-Level Design
1. **Validation Layer:** Use `zod` schemas for tool arguments. Normalize recipient strings into arrays and strip CR/LF characters before passing to Nodemailer.
2. **Email Service Enhancements:** Accept extended config (TLS options, timeouts). Wrap transporter errors with typed results.
3. **Server Layer Updates:** 
   - Expose `send_email` & `health_check` tools via `ListTools`.
   - Add per-minute rate limiter and optional allow list derived from env vars.
   - Structured logging helper that redacts credentials.
4. **Operational Feedback:** `health_check` tool exercises `verifyConnection` and reports last send outcome, rate limiter stats, and config summary (non-secret).
5. **Documentation:** Update README with new env vars, usage guidance, and security notes.

## 5. Work Plan
| Step | Description | Output |
| --- | --- | --- |
| S1 | Update deps & scaffolding (zod, docs dir) | package.json, lockfile |
| S2 | Implement validation, limiter, TLS config | `src/index.ts`, `src/email-service.ts` |
| S3 | Add health tool + logging | `src/index.ts` |
| S4 | Document configs & usage | README.md |
| S5 | Final review & merge | PR on `main` |

## 6. Testing Strategy
- Unit-like checks via `health_check` (manual).
- Manual send to a test mailbox ensuring HTML/text, CC/BCC, and rate limiting behaviors.

## 7. Risks & Mitigations
- **Risk:** Misconfigured TLS blocks legitimate sends.  
  **Mitigation:** Document fallback env vars and expose errors via health tool.
- **Risk:** In-memory limiter resets on restart.  
  **Mitigation:** Call out limitation in README; acceptable for local-first scope.


