---
paths:
  - "**/Dockerfile"
  - "**/Dockerfile.*"
  - "**/*.dockerfile"
  - "**/docker-compose*.yml"
  - "**/docker-compose*.yaml"
  - "**/compose.yml"
  - "**/compose.yaml"
---

# Container and Compose Rules

- Pin base images to a specific version or digest. A floating tag makes the build unreproducible.
- Run the application as a non-root user.
- Use multi-stage builds so build tooling, source, and development dependencies do not ship in the runtime image.
- Never bake a secret into a layer. It remains in the image even when a later layer deletes it.
- Keep the build context small with an ignore file so local state never enters the image.
- Order layers so rarely-changing steps come first and an ordinary edit does not invalidate the whole cache.
- Declare a healthcheck when an orchestrator uses it to decide readiness.
- Let the main process receive the termination signal so the container stops cleanly instead of being killed.
- Do not depend on host paths or host state that will not exist where the image actually runs.
- Keep local compose files explicit about ports, volumes, and service dependencies rather than relying on defaults.
