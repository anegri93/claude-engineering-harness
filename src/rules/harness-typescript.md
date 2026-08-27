---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript Engineering Rules

- Preserve strict typing.
- Avoid `any`. Use it only when the boundary genuinely cannot be typed and document why.
- Prefer `unknown` for untrusted or not-yet-validated values.
- Do not use type assertions to hide a type error or bypass validation.
- Avoid non-null assertions unless the invariant is proven by control flow or construction.
- Prefer discriminated unions for finite state machines and domain states.
- Use exhaustive handling for finite unions when missing a case would be a correctness bug.
- Prefer readonly data when mutation is unnecessary.
- Validate runtime data rather than trusting compile-time types at network, storage, environment, message, and user-input boundaries.
- Keep public types intentional. Do not leak persistence or transport representations into the domain without a reason.
- Prefer explicit contracts over loosely shaped objects for important boundaries.
