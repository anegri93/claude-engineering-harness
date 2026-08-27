---
paths:
  - "**/*.sql"
  - "**/migrations/**"
---

# Database and Migration Rules

- Preserve data integrity before convenience or speed.
- Prefer parameterized queries in application code.
- Make schema constraints enforce important invariants when the database can enforce them reliably.
- Treat migrations as production code.
- Consider existing data before adding non-null constraints, uniqueness, or destructive transformations.
- Avoid destructive migrations without an explicit migration and rollback strategy.
- Add indexes for demonstrated access patterns and review write cost before adding them.
- Keep transactions focused and consider failure behavior across external side effects.
- Make retry-sensitive writes idempotent when practical.
