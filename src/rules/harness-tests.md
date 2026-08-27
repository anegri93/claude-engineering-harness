---
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/test/**"
  - "**/tests/**"
---

# Test Code Rules

- Test externally meaningful behavior and invariants.
- Keep tests deterministic and independent from execution order.
- Avoid arbitrary sleeps and timing-sensitive assertions when deterministic synchronization is possible.
- Name tests after the behavior or risk they protect.
- Prefer focused fixtures and builders over large opaque setup blocks.
- A regression test should fail for the original bug and pass for the fix.
- Do not mock the unit under test.
- Mock external boundaries only when doing so improves determinism or isolation without hiding the behavior being validated.
