---
paths:
  - "**/.env*"
  - "**/config/**"
  - "**/*.config.*"
  - "**/*config*.ts"
---

# Configuration and Secret Rules

- Validate configuration once at startup against a schema and fail fast on missing or invalid values.
- Treat configuration as untrusted input, including values that come from a trusted deployment.
- Never commit secrets. Never log credentials, tokens, or connection strings.
- Read configuration at a boundary and pass it explicitly. Avoid reading environment variables deep inside business logic.
- Prefer secure defaults. An unset optional value must never silently disable a safety control.
- Keep an example environment file in sync with the real one, using placeholders and never real values.
- Make the difference between environments explicit rather than inferred from an absent variable.
- Fail closed when a security-relevant setting cannot be resolved.
- Document non-obvious constraints and units directly beside the setting.
- Treat any credential that has been exposed as compromised and regenerate it.
