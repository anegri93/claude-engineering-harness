# Claude Engineering Harness

[English](README.md) · [Español](README.es.md)

Un harness personal de Claude Code para código mantenible, seguro, correcto y escalable. Combina un estándar de ingeniería permanente, reglas semánticas específicas del repositorio, contexto de repositorio con Graft, infraestructura local de pruebas automática, verificación determinista y una línea base de ingeniería viva.

## Preflight automático del entorno

Antes de dar por rotos el lint, los tests o el build, el harness ejecuta `.claude/preflight.sh`. En un proyecto Supabase esto significa que el inicializador y el gate de Stop pueden detectar un stack local detenido, asegurar que Docker esté disponible, levantar Supabase, esperar a que esté listo y recién entonces correr la verificación del proyecto.

Todo proyecto inicializado recibe un `.claude/preflight.sh` generado, salvo que ya exista uno propio. El script generado es deliberadamente conservador.

Hoy cubre:

- Proyectos Supabase locales cuando existe `supabase/config.toml`.
- Arranque de Docker Desktop en macOS cuando Docker está instalado pero detenido.
- Docker Compose cuando el repositorio referencia Compose en `package.json` o en `scripts/`, o cuando `.claude/auto-compose` está presente de forma explícita.

Para Supabase el flujo normal es:

```text
verify
  ↓
preflight
  ↓
¿Docker corriendo? ── no ──→ levantar Docker Desktop en macOS
  ↓
¿Supabase corriendo? ── no ──→ supabase start
  ↓
esperar a que esté listo
  ↓
lint / typecheck / test / build
```

El mismo preflight corre durante el gate de calidad de Stop, así que una dependencia local detenida no deshabilita la verificación de forma permanente.

Para que el preflight solo verifique sin levantar nada:

```bash
HARNESS_AUTO_INFRA=0 .claude/verify.sh
```

Controles opcionales de timeout:

```bash
HARNESS_DOCKER_WAIT_SECONDS=120
HARNESS_SUPABASE_WAIT_SECONDS=180
```

El harness no resetea ni borra bases de datos locales cuando el arranque falla. Se detiene y reporta el problema de entorno.

## Línea base viva

`.claude/engineering-baseline.md` es una memoria técnica viva.

El ciclo de vida es:

```text
Claude edita código
      ↓
el hook PostToolUse registra los archivos afectados
      ↓
Graft mantiene fresco el contexto del repositorio
      ↓
Claude llega a Stop
      ↓
pasa el gate de verificación
      ↓
Graft arma el contexto de impacto del cambio
      ↓
Claude Opus 5 · esfuerzo alto
revalida solo los hallazgos afectados
      ↓
OPEN / CHANGED / RESOLVED / STALE
+ riesgos nuevos concretos dentro del alcance modificado
      ↓
engineering-baseline.md se actualiza solo cuando hace falta
```

El refresh es incremental. No reaudita el repositorio completo después de cada tarea.

## Estándar global

El instalador configura:

```text
Modelo:   claude-opus-5
Esfuerzo: high
```

Graft pasa a ser la capa estándar de contexto del repositorio. Durante la instalación del harness y la inicialización de proyectos, el harness consulta npm por una versión más nueva de Graft y actualiza solo cuando el registry tiene una versión superior. Nunca degrada una build instalada que esté por delante de la última de npm.

El harness global le indica a Claude priorizar en este orden:

1. Corrección
2. Seguridad e integridad de datos
3. Mantenibilidad
4. Simplicidad
5. Consistencia con la arquitectura existente
6. Rendimiento medido

También establece de forma explícita que la línea base de ingeniería es orientativa. Claude debe verificar cada hallazgo contra el código y los tests actuales antes de actuar sobre él.

## Instalar o actualizar

Desde la carpeta descargada:

```bash
chmod +x install.sh
./install.sh
```

El instalador preserva la configuración de Claude Code que no le pertenece y respalda los archivos que toca en:

```text
~/.claude/harness-backups/<timestamp>/
```

Reiniciá Claude Code después de instalar.

## Inicializar o actualizar un repositorio

Parado en cualquier punto dentro del repositorio:

```bash
~/.claude/harness-tools/init-project.sh
```

Volvé a correrlo después de actualizar el harness. Regenera los archivos de proyecto y mantiene el estado existente de la línea base viva.

El inicializador:

1. Resuelve la raíz de Git.
2. Se niega a inicializar cualquier cosa dentro de `~/.claude`.
3. Detecta stack, gestor de paquetes, forma del monorepo y comandos de verificación.
4. Instala o cablea Graft con `graft init --agents claude`.
5. Usa Graft para construir el contexto de orientación del repositorio.
6. Corre un análisis semántico de solo lectura con Claude Opus 5 y esfuerzo alto.
7. Genera `.claude/rules/` específicas del repositorio.
8. Preserva el contenido existente de `CLAUDE.md` y actualiza solo el bloque gestionado por el harness.
9. Genera `.claude/engineering-baseline.md`.
10. Genera `.claude/engineering-baseline.json` con IDs de hallazgo estables.
11. Genera o preserva `.claude/preflight.sh`.
12. Genera `.claude/verify.sh` y le cablea el preflight.
13. Prepara la infraestructura local de verificación requerida.
14. Corre la verificación de línea base.
15. Habilita `.claude/verify-on-stop` cuando la preparación del entorno y la verificación pasan.
16. Habilita `.claude/baseline-refresh-on-stop` cuando el análisis semántico y la verificación pasan.

## Estados de la línea base

Los hallazgos iniciales reciben IDs estables:

```text
F001
F002
F003
```

La línea base en Markdown puede evolucionar así:

```text
[OPEN]     el hallazgo sigue existiendo
[CHANGED]  el hallazgo original fue parcialmente corregido o acotado
[RESOLVED] el código y los tests actuales muestran que está corregido
[STALE]    la afirmación vieja ya no se sostiene
[NEW]      se introdujo o se descubrió un riesgo concreto en el alcance modificado
```

Ejemplo:

```text
Antes
[OPEN] HIGH — Health endpoint returns 200 while degraded · F001

Después de un fix verificado
[RESOLVED] HIGH — Health endpoint returns 200 while degraded · F001
```

El archivo JSON generado es el estado legible por máquina que se usa para preservar la identidad de cada hallazgo entre refreshes.

## Hooks de refresh automático

El harness instala dos hooks globales de línea base viva.

### PostToolUse

Para las herramientas de edición de Claude Code:

```text
Write
Edit
MultiEdit
NotebookEdit
```

El hook registra los archivos tocados por la tarea, en rutas relativas al repositorio, dentro del estado de runtime en:

```text
~/.claude/harness-runtime/
```

No llama a ningún modelo y no modifica el repositorio.

### Stop

El gate de Stop trabaja en este orden:

```text
1. verificar el proyecto
2. solo si la verificación pasa, refrescar los hallazgos afectados
```

La falla del refresh de línea base es fail-soft. No convierte un cambio de código exitoso en una tarea fallida. El estado sucio se conserva para que un Stop posterior reintente.

La falla de verificación sí bloquea.

## Análisis incremental de línea base

El comando de refresh normalmente es automático:

```bash
~/.claude/harness-tools/refresh-baseline.sh
```

Recibe los archivos editados durante la tarea, obtiene el contexto de impacto de Graft, le da a Claude la línea base estructurada actual y permite verificación de solo lectura del código a través de:

```text
Read
Glob
Grep
```

Le pide a Opus 5 con esfuerzo alto únicamente dos cosas:

- revalidar los hallazgos existentes que el cambio pudo haber afectado
- detectar riesgos de ingeniería nuevos y concretos dentro del radio de impacto

De forma explícita, no reaudita hallazgos no relacionados.

Se puede forzar a mano para diagnóstico:

```bash
~/.claude/harness-tools/refresh-baseline.sh --force
```

El uso normal no requiere este comando.

## Reanálisis completo

El refresh incremental mantiene hallazgos, no el modelo completo de arquitectura.

Si Opus determina que una tarea cambió materialmente la arquitectura del proyecto, la línea base registra:

```text
Full harness reanalysis recommended
```

La regeneración completa de arquitectura y reglas condicionales del proyecto la sigue haciendo:

```bash
~/.claude/harness-tools/init-project.sh
```

Esta distinción evita que cada feature ordinaria pague el costo de un análisis completo del repositorio.

## Graft y el harness

Las responsabilidades están separadas:

```text
Graft
  mapa del repositorio
  símbolos
  llamadores
  relaciones
  radio de impacto
  frescura

Harness
  política de ingeniería
  reglas específicas del proyecto
  invariantes de negocio
  hallazgos vivos
  verificación

Claude Code
  implementación y razonamiento usando ambas capas
```

La evidencia de Graft acelera la navegación. Las decisiones críticas de seguridad, corrección, reglas de negocio y mutación se siguen verificando contra el código.

## Repositorio inicializado típico

```text
repo/
├── CLAUDE.md
├── .mcp.json
└── .claude/
    ├── engineering-baseline.md
    ├── engineering-baseline.json
    ├── baseline-refresh-on-stop
    ├── preflight.sh
    ├── verify.sh
    ├── verify-on-stop
    ├── settings.json
    ├── helpers/
    ├── skills/
    │   └── graft/
    │       └── SKILL.md
    └── rules/
        ├── project-architecture.md
        ├── harness-backend-integrity.md
        ├── harness-security-boundaries.md
        ├── harness-testing-strategy.md
        └── ...
```

## Archivos globales

```text
~/.claude/
├── CLAUDE.md
├── harness/
│   ├── engineering.md
│   ├── project-analysis-prompt.md
│   ├── project-analysis-schema.json
│   ├── baseline-refresh-prompt.md
│   ├── baseline-refresh-schema.json
│   └── project-template/
├── rules/
├── skills/
│   └── engineering-review/
├── agents/
│   └── engineering-code-reviewer.md
├── hooks/
│   ├── verify-project.sh
│   └── mark-baseline-dirty.sh
├── harness-tools/
│   ├── init-project.sh
│   ├── refresh-baseline.sh
│   ├── render-project-analysis.mjs
│   ├── render-baseline-refresh.mjs
│   ├── remove-settings-hook.mjs
│   └── settings-io.mjs
├── harness-state.json
└── settings.json
```

`harness-state.json` guarda el `model` y el `effortLevel` que había en `settings.json` antes de la primera instalación, para que la desinstalación pueda restaurarlos. Se escribe una sola vez, una reinstalación no lo pisa, y la desinstalación lo borra.

## Tests

Los scripts que editan `~/.claude/settings.json` están cubiertos por tests de ida y vuelta que los corren como subprocesos reales contra un `HOME` descartable. No necesitan nada más que Node 20+:

```bash
node --test tests/*.test.mjs
```

## Costo y latencia

`init-project.sh` completo sigue siendo la operación cara, porque hace análisis profundo del repositorio.

Después de inicializar, el harness ejecuta como máximo un análisis incremental de línea base con Opus, y solo después de una tarea de Claude que efectivamente editó archivos relevantes. Múltiples ediciones dentro de la misma tarea se colapsan en un único refresh.

Las tareas sin ediciones relevantes no disparan ninguna llamada al modelo.

## Respaldos

Respaldos de la instalación global:

```text
~/.claude/harness-backups/
```

Respaldos de la inicialización de proyectos:

```text
~/.claude/harness-project-backups/
```

Respaldos de actualización de la línea base viva:

```text
~/.claude/harness-baseline-backups/
```

Archivos de análisis estructurado:

```text
~/.claude/harness-project-analysis/
```

## Desinstalar

```bash
./uninstall.sh
```

El desinstalador elimina los archivos y hooks globales que le pertenecen al harness. Preserva los directorios de respaldo y no desinstala Graft de forma global.
