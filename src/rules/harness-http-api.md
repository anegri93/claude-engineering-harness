---
paths:
  - "**/routes/**"
  - "**/api/**"
  - "**/handlers/**"
  - "**/controllers/**"
  - "**/*.route.*"
  - "**/*.controller.*"
---

# HTTP API Rules

- Validate body, query, params, and headers against a schema at the boundary before any value is used.
- Treat every client-supplied identifier as untrusted input, never as proof of ownership.
- Authorize each request against the authenticated principal. Authentication does not establish authorization.
- Return errors that are safe to expose and keep internal messages, stack traces, and identifiers server-side.
- Use status codes that reflect what actually happened, including for authorization failures.
- Bound list endpoints with a maximum page size the client cannot exceed.
- Set an explicit timeout on every outbound call made while serving a request.
- Make mutating endpoints idempotent when a client can reasonably retry them.
- Keep handlers thin. Parse, authorize, delegate. Business rules belong in independently testable units.
- Do not log request bodies, credentials, tokens, or personal data.
- Consider rate limiting and abuse behavior for publicly reachable endpoints.
