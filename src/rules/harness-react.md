---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
---

# React Engineering Rules

- Keep components focused on one UI responsibility.
- Prefer deriving values during render over storing redundant state.
- Use effects to synchronize with external systems, not as a default mechanism for data flow.
- Keep state as local as practical and lift it only when multiple consumers require ownership above them.
- Avoid hidden coupling through global state when props, context, or a focused store boundary is clearer.
- Preserve accessibility semantics and keyboard behavior for interactive UI.
- Handle loading, empty, error, and success states when the user-visible flow can reach them.
- Avoid premature memoization. Optimize rendering when profiling or clear cost justifies it.
- Keep business rules outside presentation components when they are independently testable domain behavior.
