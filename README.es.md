# Claude Engineering Harness

[English](README.md) · [Español](README.es.md)

### Tu agente de código deja de adivinar, deja de olvidar, y deja de decir "listo" sin pruebas.

`claude-engineering-harness` es un harness personal para Claude Code. Instala un estándar de ingeniería fijo en cada sesión, genera reglas a partir de una lectura semántica de tu repositorio real, condiciona el fin de cada tarea a una verificación que realmente corrió, y mantiene una línea base de riesgos conocidos que envejece con el código en vez de quedar obsoleta.

Herramienta personal, hecha para mis propios proyectos. Se instala global en `~/.claude` y se inicializa por repositorio.

---

## Contenido

- [Arranque rápido](#arranque-rápido)
- [El problema](#el-problema)
- [Qué hace el harness](#qué-hace-el-harness)
- [El estándar de ingeniería](#el-estándar-de-ingeniería)
- [Qué corre y cuándo](#qué-corre-y-cuándo)
- [Para qué sirve cada archivo generado](#para-qué-sirve-cada-archivo-generado)
- [Qué corre la verificación](#qué-corre-la-verificación)
- [Tests](#tests)
- [Estados de la línea base](#estados-de-la-línea-base)
- [Graft y el harness](#graft-y-el-harness)
- [Costo](#costo)
- [Respaldos](#respaldos)
- [Desinstalar](#desinstalar)

---

## Arranque rápido

```bash
chmod +x install.sh
./install.sh                              # estándar global, hooks, skill, agente
~/.claude/harness-tools/init-project.sh   # parado dentro del repo que quieras cubrir
```

Eso es toda la instalación. `install.sh` escribe el estándar en `~/.claude` y cablea dos hooks en tu configuración de Claude Code. `init-project.sh` lee el repositorio, escribe reglas específicas para él, genera la línea base y el script de verificación, y enciende el gate de Stop una vez que probó que la verificación funciona. De la próxima sesión en adelante, el harness viaja con vos.

Reiniciá Claude Code después de instalar. Volvé a correr `init-project.sh` después de actualizar el harness: regenera los archivos del proyecto y conserva el estado existente de la línea base.

Necesita Node 20+, Git, y npm para Graft. No se pisa nada: el instalador preserva la configuración de Claude Code que no le pertenece y respalda cada archivo que toca en `~/.claude/harness-backups/<timestamp>/`.

---

## El problema

Tu agente termina una tarea y te dice que está listo. El lint nunca corrió. La suite de tests nunca corrió. El resumen es seguro, el diff es plausible, y nadie lo chequeó. Te enterás después.

Debajo de eso, tres cosas más fallan en cada sesión:

- **Ciego.** Reexplora el repo desde cero, un grep y un archivo por vez, reconstruyendo una imagen que ya tenía hace una hora y tiró.
- **Desmemoriado.** Un riesgo encontrado el martes desapareció el miércoles. Nada persiste entre sesiones, así que el mismo punto débil se redescubre o se reintroduce en silencio.
- **Desactivado.** Docker estaba caído, los tests "fallaron", el gate de verificación se volvió ruido, lo apagaste. Ahora no se chequea nada.

Un ingeniero senior sostiene un estándar, se acuerda de qué es frágil, y no declara un chequeo que se salteó. El harness hace que el agente haga lo mismo, de forma mecánica, en vez de confiar.

---

## Qué hace el harness

- **Un estándar fijo, en cada sesión.** Una sola política de ingeniería cargada en todos los repositorios, con un orden de prioridad explícito para los tradeoffs y una regla explícita contra declarar verificado lo que no se verificó.
- **Reglas de tu código, no de una plantilla.** `init-project.sh` corre un análisis semántico de solo lectura del repositorio con Opus 5 y escribe `.claude/rules/` describiendo la arquitectura, los límites y los invariantes de este código.
- **Un gate que no se puede esquivar hablando.** El hook de Stop corre formato, lint, tipos, tests y build antes de que la tarea pueda terminar. Si falla, bloquea.
- **El entorno se levanta, no se culpa.** Antes de declarar algo roto, un preflight levanta Docker y Supabase y espera. Un contenedor detenido no es un test que falla.
- **Hallazgos que sobreviven la sesión.** Los riesgos reciben IDs estables y se revalidan cuando un cambio pudo haberlos tocado. Los corregidos pasan a `[RESOLVED]`, los obsoletos a `[STALE]`.
- **Una segunda opinión a pedido.** Una skill de review y un agente revisor independiente, ambos de solo lectura, para pasadas de production-readiness.

---

## El estándar de ingeniería

El núcleo del harness es `~/.claude/harness/engineering.md`, que se carga en cada sesión. Es opinado a propósito.

Cuando hay tradeoffs, fija el orden:

```text
1. Corrección
2. Seguridad e integridad de datos
3. Mantenibilidad
4. Simplicidad
5. Consistencia con la arquitectura existente
6. Rendimiento cuando hay evidencia que lo respalde
```

El rendimiento va último a propósito. Se optimiza cuando se mide, no cuando se sospecha.

El resto del estándar es lo que un revisor te iba a pedir igual:

| Regla | Qué exige |
|---|---|
| **Entender antes de cambiar** | Leer la implementación. Identificar llamadores, dependencias, efectos secundarios. Nunca implementar a partir de un nombre de archivo o una suposición. |
| **Diseñar para la falla** | Entrada inválida, datos desactualizados, timeouts, fallas parciales, operaciones duplicadas, reintentos, concurrencia, operaciones interrumpidas. Nunca tragarse un error en silencio. |
| **Entrada no confiable** | Validar en los bordes. La autenticación no reemplaza a la autorización. Parametrizar queries. Nunca loguear credenciales. Sanitizar errores que cruzan un límite de confianza. |
| **Sostener el alcance** | Sin refactors no relacionados. Sin abstracciones especulativas. Sin rediseñar arquitectura que funciona sin una razón concreta. |
| **Testear riesgo, no forma** | Cubrir reglas de negocio, casos borde, caminos de falla, regresiones, concurrencia. Nunca debilitar un test válido para que un cambio pase. |
| **Terminar con honestidad** | Inspeccionar el diff final, correr formato, lint, tipos, tests y build, y después revisar el diff como si estuviera aprobando el trabajo de otro para producción. Si un paso no se pudo correr, decir exactamente qué no se verificó y por qué. |

Esa última fila es la que el gate de Stop hace cumplir de forma mecánica en vez de confiar.

El instalador también fija el modelo y el esfuerzo con el que corre este trabajo:

```text
Modelo:   claude-opus-5
Esfuerzo: high
```

---

## Qué corre y cuándo

Cuatro cosas se disparan solas. No hay nada más para correr a mano.

```text
Claude edita un archivo
      ↓  hook PostToolUse · sin llamada al modelo
registra qué archivos tocó la tarea
      ↓
Claude termina la tarea
      ↓  hook Stop
preflight  →  levanta Docker / Supabase si están caídos
      ↓
verify     →  formato · lint · tipos · tests · build
      ↓  bloquea si falla
refresh    →  Opus 5 revalida solo los hallazgos que el cambio pudo alcanzar
      ↓  fail-soft
engineering-baseline.md se actualiza solo si algo cambió
```

**PostToolUse** se dispara con `Write`, `Edit`, `MultiEdit` y `NotebookEdit`, y registra rutas relativas al repositorio en `~/.claude/harness-runtime/<proyecto>/`. No llama a ningún modelo y no toca código. Existe para que el refresh conozca el radio de impacto sin adivinar. Ignora su propia contabilidad: las ediciones a los archivos de línea base, a `.claude/rules/`, a `verify.sh`, y a `graft/`, `node_modules/`, `dist/`, `build/` y `coverage/` nunca marcan el proyecto como sucio.

**El hook de Stop** corre verify primero y refresh segundo, y el orden es el punto. La falla de verificación bloquea la tarea. La falla del refresh es fail-soft: nunca convierte un buen cambio en una tarea fallida, y el estado sucio se conserva para que el próximo Stop reintente.

**El preflight** chequea si Docker está instalado pero detenido, si existe `supabase/config.toml` con el stack caído, y si el repo realmente referencia Docker Compose. Las dos esperas están acotadas y se pueden sobrescribir:

```bash
HARNESS_DOCKER_WAIT_SECONDS=120
HARNESS_SUPABASE_WAIT_SECONDS=180
HARNESS_AUTO_INFRA=0 .claude/verify.sh   # solo chequea, no levanta nada
```

Nunca resetea ni borra una base de datos local para recuperarse de un arranque fallido. Se detiene y reporta el problema de entorno.

**El refresh** le entrega a Opus 5 la línea base estructurada actual más el contexto de impacto de Graft, restringido a `Read`, `Glob` y `Grep`. No puede editar. Se le piden dos cosas y nada más: revalidar los hallazgos que el cambio pudo haber afectado, y marcar riesgos nuevos y concretos dentro del radio de impacto.

---

## Para qué sirve cada archivo generado

### En tu repositorio

Los escribe `init-project.sh`, salvo donde se indica.

| Archivo | Qué es |
|---|---|
| `CLAUDE.md` | Las instrucciones de tu proyecto. El harness actualiza solo su propio bloque gestionado y preserva todo lo demás que escribiste. |
| `.claude/rules/project-architecture.md` | El perfil de arquitectura que escribió Opus después de leer tu repositorio: módulos, límites, flujo de datos, invariantes. Este es el archivo que hace que el consejo sea específico en vez de genérico. |
| `.claude/rules/harness-*.md` | Reglas condicionales que se cargan solo para las rutas que coinciden. Integridad de backend, límites de seguridad, estrategia de testing, y lo que el análisis haya juzgado que este repo necesita. |
| `.claude/engineering-baseline.md` | La lista legible de riesgos de ingeniería conocidos, cada uno con un ID estable y un estado. Este es el archivo que leés vos. |
| `.claude/engineering-baseline.json` | Los mismos hallazgos como estado de máquina. Existe para que un hallazgo conserve su identidad entre refreshes en vez de reescribirse como uno nuevo cada vez. |
| `.claude/verify.sh` | El comando de verificación de este proyecto. Detecta tu gestor de paquetes y corre los chequeos que realmente tenés. Editalo con libertad: es tuyo, y un proyecto que no sea Node tiene que personalizarlo. |
| `.claude/preflight.sh` | Levanta la infraestructura local antes de que la verificación juzgue nada. Se genera solo si todavía no tenés uno; un preflight propio nunca se pisa. |
| `.claude/verify-on-stop` | Un archivo marcador vacío. Su presencia es lo que habilita el gate de verificación en Stop. Borralo para apagar el gate en ese repo. |
| `.claude/baseline-refresh-on-stop` | La misma idea para el refresh de línea base. Los dos marcadores se escriben recién después de probar una vez que ese paso funciona, así un repo donde la verificación no puede correr nunca se lleva un gate que falle para siempre. |
| `.claude/auto-compose` | Opcional, lo creás vos. Su presencia le indica al preflight que levante Docker Compose en un repo que de otro modo no lo referencia. |
| `.claude/settings.json` | Configuración de Claude Code a nivel proyecto. |
| `.mcp.json`, `.claude/skills/graft/`, `.claude/helpers/` | Los escribe `graft init`, no el harness. El harness los respalda primero y después deja que Graft sea el dueño. |

### Globales, en `~/.claude`

| Archivo | Qué es |
|---|---|
| `harness/engineering.md` | El estándar de ingeniería en sí. El archivo más importante del repo. |
| `harness/project-analysis-prompt.md` + `.json` | El prompt y el schema JSON del análisis inicial del repositorio. El schema es lo que fuerza salida estructurada en vez de prosa. |
| `harness/baseline-refresh-prompt.md` + `.json` | El mismo par para el refresh incremental. |
| `harness/project-template/` | Los esqueletos de `CLAUDE.md`, `verify.sh`, `preflight.sh` y la regla de arquitectura que `init-project.sh` copia y completa. |
| `rules/harness-typescript.md` · `-react` · `-tests` · `-sql` | Reglas de lenguaje que se cargan automáticamente para las rutas que coinciden, en cualquier proyecto. |
| `skills/engineering-review/SKILL.md` | La skill de review: una pasada de production-readiness sobre corrección, seguridad, mantenibilidad, escalabilidad y calidad de tests. |
| `agents/engineering-code-reviewer.md` | Un agente revisor de solo lectura que no puede editar, para una segunda opinión independiente sobre un cambio terminado. |
| `hooks/mark-baseline-dirty.sh` | El hook PostToolUse. Registra archivos editados, no llama a ningún modelo. |
| `hooks/verify-project.sh` | El hook de Stop. Corre preflight, verificación, y después refresh. |
| `harness-tools/` | `init-project.sh` y `refresh-baseline.sh`, más los renderers que convierten la salida estructurada del modelo en Markdown, y los helpers de settings que usan install y uninstall. |
| `harness-runtime/<proyecto>/` | Estado sucio por proyecto, escrito por el hook PostToolUse y consumido por el refresh. Descartable. |
| `harness-state.json` | El `model` y el `effortLevel` que tenía tu `settings.json` antes de la primera instalación, para que la desinstalación pueda restaurarlos. Se escribe una sola vez, una reinstalación no lo pisa, la desinstalación lo borra. |

---

## Qué corre la verificación

`.claude/verify.sh` elige tu gestor de paquetes según el lockfile — `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb` o `bun.lock`, y si no, npm — y después corre los chequeos más fuertes que el proyecto ya tiene, primero los baratos y no mutantes, deteniéndose en la primera falla:

```text
fmt:check       formato
format:check    formato, nombre de script alternativo
lint            análisis estático
typecheck       cae a test:types si no existe
test            tu suite
build           último, el más caro
```

Cada uno se saltea si `package.json` no tiene ese script. No se inventa nada y no se adivina nada. Un proyecto que solo tiene `lint` y `test` corre exactamente esos dos.

En un proyecto que no es Node, `verify.sh` sale y te pide personalizarlo. Es deliberado. Verificar nada en silencio es peor que decir que no puede.

---

## Tests

Dos cosas distintas comparten la palabra, así que conviene ser exacto.

**En tu repositorio, el harness corre tests. No los escribe.** La verificación ejecuta tu script `test` existente a través de tu gestor de paquetes. No genera tests, no inventa un comando de test, y no trata tu suite como opcional. Sin script `test`, ese paso se saltea y el resto igual corre.

Lo que el harness sí aporta es política. Cuando Claude escribe tests bajo `**/*.test.*`, `**/*.spec.*`, `**/test/**` o `**/tests/**`, estas reglas se cargan solas:

- Testear comportamiento e invariantes con significado externo, no detalles de implementación.
- Mantener los tests deterministas e independientes del orden de ejecución.
- Evitar sleeps arbitrarios y aserciones sensibles al tiempo cuando hay sincronización determinista disponible.
- Nombrar cada test por el comportamiento o el riesgo que protege.
- Un test de regresión debe fallar con el bug original y pasar con el fix.
- No mockear la unidad bajo prueba. Mockear límites externos solo cuando mejora el determinismo sin esconder el comportamiento que se está validando.
- Nunca debilitar ni borrar un test válido para que un cambio pase.

**Este repositorio tiene sus propios tests.** Los scripts que editan `~/.claude/settings.json` están cubiertos por tests de ida y vuelta que los corren como subprocesos reales contra un `HOME` descartable, porque el riesgo que cargan es lo que le hacen a un archivo de configuración real en disco. No hace falta nada más que Node 20+:

```bash
node --test tests/*.test.mjs
```

CI los corre en Node 20, 22 y 24, y lintea todos los scripts de shell con un shellcheck pineado.

---

## Estados de la línea base

Los hallazgos reciben IDs estables — `F001`, `F002`, `F003` — y un estado que se mueve con el código:

```text
[OPEN]     el hallazgo sigue existiendo
[CHANGED]  parcialmente corregido o acotado
[RESOLVED] el código y los tests actuales muestran que está corregido
[STALE]    la afirmación vieja ya no se sostiene
[NEW]      un riesgo concreto introducido o encontrado en el alcance modificado
```

```text
Antes
[OPEN] HIGH — Health endpoint returns 200 while degraded · F001

Después de un fix verificado
[RESOLVED] HIGH — Health endpoint returns 200 while degraded · F001
```

La línea base es orientativa, no autoritativa. El estándar le indica a Claude verificar cada hallazgo contra el código y los tests actuales antes de actuar sobre él, porque un hallazgo escrito hace tres semanas puede estar ya corregido.

El refresh mantiene hallazgos, no el modelo de arquitectura. Si Opus decide que una tarea cambió materialmente la arquitectura, la línea base registra `Full harness reanalysis recommended` y volvés a correr `init-project.sh`. Esa división es la razón por la que una feature ordinaria nunca paga un análisis completo del repositorio.

---

## Graft y el harness

Dos capas, sin superposición:

```text
Graft                        Harness
  mapa del repositorio         política de ingeniería
  símbolos                     reglas específicas del proyecto
  llamadores                   invariantes de negocio
  relaciones                   hallazgos vivos
  radio de impacto             verificación
  frescura
```

Graft responde *dónde están las cosas y qué tocan*. El harness decide *qué es bueno y si terminaste*. Claude Code usa las dos.

La evidencia de Graft acelera la navegación. Las decisiones críticas de seguridad, corrección, reglas de negocio y mutación se siguen verificando contra el código, y el estándar lo dice explícitamente.

Al instalar y al inicializar un proyecto, el harness le pregunta a npm si hay un Graft más nuevo y actualiza solo cuando el registry está por delante. Nunca degrada una build local más nueva que la última de npm.

---

## Costo

`init-project.sh` es la llamada cara. Lee el repositorio en profundidad, una vez.

Después de eso, como máximo un análisis incremental de línea base por tarea de código, y solo cuando la tarea editó archivos relevantes. Varias ediciones en una misma tarea se colapsan en un único refresh. Una tarea que no editó nada relevante no hace ninguna llamada al modelo.

---

## Respaldos

Nada se pisa sin una copia previa.

```text
~/.claude/harness-backups/            instalación global
~/.claude/harness-project-backups/    inicialización de proyectos
~/.claude/harness-baseline-backups/   actualizaciones de la línea base viva
~/.claude/harness-project-analysis/   archivos de análisis estructurado
```

---

## Desinstalar

```bash
./uninstall.sh
```

Elimina los archivos y hooks globales propios del harness, y restaura la configuración de modelo y esfuerzo que tenías antes de la primera instalación. Los directorios de respaldo se preservan. Graft queda instalado.

---

## Licencia

MIT. Ver [LICENSE](LICENSE).
