# Claude Engineering Harness

[English](README.md) · [Español](README.es.md)

Convierte a Claude Code de un asistente que escribe código plausible en uno que trabaja contra un estándar de ingeniería fijo, conoce tu repositorio, y no puede dar un cambio por terminado hasta que los chequeos realmente pasen.

Herramienta personal, hecha para mis propios proyectos. Se instala global en `~/.claude` y se inicializa por repositorio.

## Por qué existe

Un agente de código librado a su suerte tiene cuatro fallas recurrentes. Cada capa de este harness existe para cerrar una.

**Dice "listo" sin pruebas.** El agente termina, resume con seguridad, y el lint o la suite de tests nunca corrieron. El harness condiciona el fin de cada tarea a una verificación real, y prohíbe afirmar que un chequeo corrió cuando no corrió.

**Redescubre el repositorio en cada sesión.** Exploración amplia y superficial, archivo por archivo, pagando la misma orientación una y otra vez. El harness hace de Graft la capa estándar de contexto, así el agente arranca desde un mapa del repositorio y un radio de impacto en vez de una corazonada.

**Se olvida de lo que ya sabe que está mal.** Los riesgos encontrados en una sesión desaparecen en la siguiente. El harness mantiene una línea base viva de hallazgos con IDs estables, y revalida los que un cambio pudo haber afectado.

**La verificación se apaga apenas molesta.** La infraestructura local está caída, los tests "fallan", y el gate se vuelve ruido que conviene desactivar. El harness distingue un entorno roto de código roto, y levanta el entorno él mismo antes de declarar que algo está roto.

## Qué obtenés

- Un estándar de ingeniería permanente aplicado a cada cambio, con un orden de prioridad explícito para los tradeoffs.
- Reglas específicas del repositorio, generadas a partir de un análisis semántico de tu código real, no consejos genéricos.
- Un gate de verificación al terminar cada tarea: formato, lint, tipos, tests, build.
- Arranque automático de la infraestructura local antes de que la verificación decida que algo falló.
- Una línea base viva de hallazgos de ingeniería que envejece y se actualiza en vez de quedar obsoleta.
- Una skill de review y un agente revisor independiente para pasadas de production-readiness.

## Arranque rápido

Instalación global:

```bash
chmod +x install.sh
./install.sh
```

Reiniciá Claude Code y después, parado en cualquier punto dentro del repositorio que quieras cubrir:

```bash
~/.claude/harness-tools/init-project.sh
```

Eso analiza el repositorio, escribe `.claude/rules/`, genera la línea base y el script de verificación, y enciende el gate de Stop una vez que la verificación pasa. De ahí en más es automático.

Requiere Node 20+, Git, y npm para Graft. El instalador preserva la configuración de Claude Code que no le pertenece y respalda cada archivo que toca en `~/.claude/harness-backups/<timestamp>/`.

Volvé a correr `init-project.sh` después de actualizar el harness. Regenera los archivos del proyecto y conserva el estado existente de la línea base viva.

## El estándar de ingeniería

El núcleo del harness es un estándar que se carga en cada sesión. Es opinado a propósito.

Cuando hay tradeoffs, fija el orden de prioridad:

```text
1. Corrección
2. Seguridad e integridad de datos
3. Mantenibilidad
4. Simplicidad
5. Consistencia con la arquitectura existente
6. Rendimiento cuando hay evidencia que lo respalde
```

El rendimiento va último a propósito: se optimiza cuando se mide, no cuando se sospecha.

El estándar además le exige al agente:

- **Entender antes de cambiar.** Leer la implementación, identificar llamadores, dependencias y efectos secundarios. Nunca implementar a partir de un nombre de archivo o una suposición.
- **Diseñar para la falla.** Entrada inválida, datos desactualizados, timeouts, fallas parciales, operaciones duplicadas, reintentos, concurrencia, operaciones interrumpidas. Nunca tragarse un error en silencio.
- **Tratar la entrada externa como no confiable.** Validar en los bordes, la autenticación no reemplaza a la autorización, parametrizar queries, nunca loguear credenciales, sanitizar errores que cruzan un límite de confianza.
- **Sostener el alcance.** Sin refactors no relacionados, sin abstracciones especulativas, sin rediseñar arquitectura que funciona sin una razón concreta.
- **Testear comportamiento y riesgo**, no detalles de implementación. Nunca debilitar un test válido para que un cambio pase.
- **Terminar con honestidad.** Inspeccionar el diff final, correr formato, lint, tipos, tests y build, y después revisar el diff como si estuviera aprobando el trabajo de otro para producción. Si un paso no se pudo correr, decir exactamente qué no se verificó y por qué.

Esa última regla es la que el gate de Stop hace cumplir de forma mecánica en vez de confiar.

El instalador también fija el modelo y el esfuerzo con el que se hace este trabajo:

```text
Modelo:   claude-opus-5
Esfuerzo: high
```

## Cómo funciona

Cuatro capas, cada una con un solo trabajo.

```text
Estándar de ingeniería   política fija, cada sesión, cada repositorio
Reglas de proyecto       generadas del análisis semántico de este repositorio
Gate de verificación     preflight del entorno, después formato/lint/tipos/tests/build
Línea base viva          hallazgos que persisten entre sesiones y envejecen con el código
```

Se encuentran al final de una tarea:

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

El refresh de la línea base es incremental. No reaudita el repositorio entero después de cada tarea, y una tarea que no editó nada relevante no dispara ninguna llamada al modelo.

La línea base es orientativa, no autoritativa. El estándar le indica explícitamente a Claude verificar cada hallazgo contra el código y los tests actuales antes de actuar sobre él, porque un hallazgo escrito hace tres semanas puede estar ya corregido.

## Qué corre en cada paso

### 1. Mientras Claude edita — hook PostToolUse

Se dispara con `Write`, `Edit`, `MultiEdit` y `NotebookEdit`. Registra en `~/.claude/harness-runtime/` las rutas relativas al repositorio que la tarea tocó.

No llama a ningún modelo y no modifica el repositorio. Existe para que el refresh posterior de la línea base conozca el radio de impacto sin tener que adivinarlo.

### 2. Termina la tarea — hook Stop

Corre dos cosas en un orden fijo, y el orden es el punto:

```text
1. verificar el proyecto
2. solo si la verificación pasó, refrescar los hallazgos afectados
```

La falla de verificación bloquea. La falla del refresh es fail-soft: nunca convierte un cambio de código exitoso en una tarea fallida, y el estado sucio se conserva para que un Stop posterior reintente.

### 3. Antes de verificar — preflight del entorno

Corre `.claude/preflight.sh` primero, para que una dependencia local detenida nunca se confunda con código roto. Chequea, en orden:

- ¿Docker está instalado pero no corriendo? En macOS, levanta Docker Desktop y espera.
- ¿Existe `supabase/config.toml`? Si el stack local está caído, corre `supabase start` y espera hasta que esté listo.
- ¿El repositorio realmente referencia Docker Compose en `package.json` o en `scripts/`, o está presente `.claude/auto-compose`? Recién ahí levanta Compose.

Las dos esperas están acotadas, y los valores por defecto se pueden sobrescribir:

```bash
HARNESS_DOCKER_WAIT_SECONDS=120
HARNESS_SUPABASE_WAIT_SECONDS=180
```

Nunca resetea ni borra una base de datos local para recuperarse de un arranque fallido. Se detiene y reporta el problema de entorno. Para que una corrida solo verifique, sin levantar nada:

```bash
HARNESS_AUTO_INFRA=0 .claude/verify.sh
```

### 4. Verificación — `.claude/verify.sh`

Elige el gestor de paquetes según el lockfile: `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb` o `bun.lock`, y si no, npm.

Después corre los chequeos más fuertes que el proyecto ya tiene, primero los baratos y no mutantes, deteniéndose en la primera falla:

```text
fmt:check       formato, no mutante
format:check    formato, nombre de script alternativo
lint            análisis estático
typecheck       cae a test:types si no existe
test            la suite propia del proyecto
build           último, el más caro
```

Cada uno se saltea si `package.json` no tiene ese script. No se inventa nada y no se adivina nada. Un proyecto que solo tiene `lint` y `test` corre exactamente esos dos.

En un proyecto que no es Node, verify.sh sale y te pide personalizarlo. Eso es deliberado: verificar nada en silencio es peor que decir que no puede.

### 5. Refresh de línea base — `refresh-baseline.sh`

Recibe los archivos editados, le pide a Graft el contexto de impacto del cambio, y le entrega a Claude la línea base estructurada actual.

El modelo corre restringido a herramientas de solo lectura:

```text
Read
Glob
Grep
```

No puede editar, y se le piden exactamente dos cosas: revalidar los hallazgos existentes que el cambio pudo haber afectado, y detectar riesgos nuevos y concretos dentro del radio de impacto. No reaudita hallazgos no relacionados.

### 6. Inicialización del repositorio — `init-project.sh`

El caro, se corre a mano. Hace:

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

Los pasos 15 y 16 importan: los gates automáticos se encienden solo si se probó una vez que funcionan. Un repositorio donde la verificación no puede correr no se lleva un gate que falle para siempre.

## Tests

Dos cosas distintas comparten la palabra, así que conviene ser exacto.

**En tu repositorio, el harness corre tests, no los escribe.** La verificación ejecuta tu script `test` existente a través de tu gestor de paquetes. No genera tests, no inventa un comando de test, y no trata tu suite como opcional. Si no tenés script `test`, ese paso se saltea y los demás chequeos igual corren.

Lo que el harness sí aporta al testing es política. Cuando Claude escribe tests bajo `**/*.test.*`, `**/*.spec.*`, `**/test/**` o `**/tests/**`, estas reglas se cargan automáticamente:

- Testear comportamiento e invariantes con significado externo, no detalles de implementación.
- Mantener los tests deterministas e independientes del orden de ejecución.
- Evitar sleeps arbitrarios y aserciones sensibles al tiempo cuando hay sincronización determinista disponible.
- Nombrar cada test por el comportamiento o el riesgo que protege.
- Un test de regresión debe fallar con el bug original y pasar con el fix.
- No mockear la unidad bajo prueba. Mockear límites externos solo cuando mejora el determinismo sin esconder el comportamiento que se está validando.
- Nunca debilitar ni borrar un test válido para que un cambio pase.

**Este repositorio tiene sus propios tests.** Los scripts que editan `~/.claude/settings.json` están cubiertos por tests de ida y vuelta que los corren como subprocesos reales contra un `HOME` descartable, porque el riesgo que cargan es lo que le hacen a un archivo de configuración real en disco. No necesitan nada más que Node 20+:

```bash
node --test tests/*.test.mjs
```

CI los corre en Node 20, 22 y 24, y lintea todos los scripts de shell con un shellcheck pineado.

## Estados de la línea base

Los hallazgos reciben IDs estables:

```text
F001
F002
F003
```

La línea base en Markdown después evoluciona:

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

`.claude/engineering-baseline.json` es el estado legible por máquina que preserva la identidad de cada hallazgo entre refreshes.

## Reanálisis completo

El refresh incremental mantiene hallazgos, no el modelo completo de arquitectura.

Si Opus determina que una tarea cambió materialmente la arquitectura del proyecto, la línea base registra:

```text
Full harness reanalysis recommended
```

Regenerar arquitectura y reglas condicionales del proyecto lo sigue haciendo `init-project.sh`. Esta distinción evita que cada feature ordinaria pague el costo de un análisis completo del repositorio.

Se puede forzar un refresh a mano para diagnóstico, aunque el uso normal nunca lo requiere:

```bash
~/.claude/harness-tools/refresh-baseline.sh --force
```

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

Durante la instalación y la inicialización de proyectos, el harness consulta npm por una versión más nueva de Graft y actualiza solo cuando el registry está por delante. Nunca degrada una build local que sea más nueva que la última de npm.

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

## Costo y latencia

`init-project.sh` es la operación cara, porque hace análisis profundo del repositorio.

Después de inicializar, el harness ejecuta como máximo un análisis incremental de línea base por tarea de código, y solo cuando esa tarea editó archivos relevantes. Varias ediciones dentro de una misma tarea se colapsan en un único refresh. Las tareas sin ediciones relevantes no disparan ninguna llamada al modelo.

## Respaldos

```text
~/.claude/harness-backups/            instalación global
~/.claude/harness-project-backups/    inicialización de proyectos
~/.claude/harness-baseline-backups/   actualizaciones de la línea base viva
~/.claude/harness-project-analysis/   archivos de análisis estructurado
```

## Desinstalar

```bash
./uninstall.sh
```

Elimina los archivos y hooks globales que le pertenecen al harness, y restaura la configuración de modelo y esfuerzo que había antes de la primera instalación. Preserva los directorios de respaldo y no desinstala Graft de forma global.
