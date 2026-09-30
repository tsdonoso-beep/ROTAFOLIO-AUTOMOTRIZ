# Pipeline de CPE por la API de SUNAT (`scripts/local/`)

> Cómo se bajan los XML y PDF de los comprobantes de compra **que no son
> serie E001**, cómo correrlo en una laptop y en GitHub Actions, y qué mirar
> cuando algo falla. Vigente desde el 30/09/2026.

---

## 1. En una frase

Entra a SOL **una vez**, toma el token con que la pantalla «Nueva Consulta de
comprobantes de pago» llama a su propia API (`api-cpe.sunat.gob.pe`) y baja el
XML y el PDF de cada pendiente **directo de esa API**, 8 a la vez, sin tocar
pantallas. Después los archiva en Drive y los guarda en Supabase, igual que los
otros workflows.

| | Por pantallas (antes) | Por API (ahora) |
|---|---|---|
| Tiempo por comprobante | 20-30 s | ~300 ms el XML |
| Éxito | ~20% desde el 29/09 | ~88% a la primera; casi todo el resto al reintentar |
| Ago+sep (2 362 pendientes) | semanas | 5 min de SUNAT + ~25 min de Drive |

## 2. Por qué funciona (lo que se descubrió)

- **Las series.** E001 = emitido desde el portal gratuito de SUNAT; esos los
  trae la consulta por rango (`descargar-cpe`). F001, FC01, FF01… = emitidos
  con el sistema propio del proveedor; esos solo se pueden pedir **uno por uno**
  (RUC + tipo + serie + número). La lista de qué pedir sale del SIRE
  (`comprobantes_sunat`).
- **La pantalla era una fachada.** Por debajo llama a:
  - `GET …/consultacpe/comprobantes/{rucEmisor}-{tipo}-{serie}-{numero}-2` → cabecera
  - `GET …/comprobantes/{id}/02` → XML (zip en base64) · `/01` → PDF · `/03` → CDR
  - (`-2` = recibido; `-1` = emitido). Rutas leídas del código público de la app.
- **El «Error del Servidor, reintentar en 5 minutos» era un 500 de la cabecera.**
  La pantalla consulta la cabecera primero y, si falla, nunca muestra el botón
  del XML. Por API se va directo al XML: comprobantes que por pantalla daban
  500 siempre (p. ej. F002-3792) bajan a la primera.
- **Los 500 de SUNAT son intermitentes**: el mismo pedido falla y a los 30 s
  funciona. Por eso se reintenta (ver §6).
- **SUNAT corta el `fetch` de Node** (`UND_ERR_SOCKET other side closed`), incluso
  sin token. Se pide con el cliente HTTP de Playwright (`contexto.request`), que
  sí acepta y además comparte las cookies de SOL.
- **En «Error del Servidor» NUNCA clicar «Aceptar»**: cierra la sesión de SOL
  entera. (Solo importa en la vía por pantallas.)

## 3. Cómo está armado

```
            ┌─────────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────┐
 SIRE ─────▶│ SUNAT (API) │──▶│   PDF    │──▶│  Drive   │──▶│ Supabase │──▶│ Hoja │
 pendientes │ 8 a la vez  │   │ 6 a la vez│  │ 6 a la vez│  │ lotes 20 │   │ al   │
            │ XML ~300 ms │   │ 4 intentos│  │ + disco   │  │guardar_cpe│  │ final│
            └─────┬───────┘   └──────────┘   └──────────┘   └──────────┘   └──────┘
                  │ 500/timeout → vuelve AL FINAL de la cola (30 s), hasta 6 intentos
```

Cada etapa es una **cola propia**: un trabajador de SUNAT baja el XML y sigue
con otro sin esperar al PDF ni a Drive. Cada etapa se reporta por separado
(§5).

| Archivo | Qué hace |
|---|---|
| `cpe.mts` | El principal: arma la tubería y los trabajadores |
| `sondear-api.mts` | Prueba las formas de pedirle a SUNAT sobre una muestra, **sin guardar nada** |
| `estado.mts` | Muestra cómo va cada corrida, por etapa, desde otra terminal |
| `estado-hojas.mts` | Qué tienen hoy las hojas publicadas en Drive |
| `consolidar-db.mts` | Genera `db/database.full.sql` con todas las migraciones |
| `comun/tuberia.mts` | Las colas (SUNAT → PDF → Drive → base), reintentos, pausa si SUNAT cae |
| `comun/etapas.mts` | Números y fin de cada etapa; escribe `estado.json` |
| `comun/tipos.mts` | Lo puro: clasificar errores, política de reintentos, id de la API |
| `comun/base.mts` · `drive.mts` | Supabase (pendientes, `guardar_cpe`, hoja) y Drive (con respaldo en disco) |
| `comun/barra.mts` · `bitacora.mts` · `config.mts` | Barra de progreso, logs, variables de entorno |
| `api/cliente.mts` · `trabajador-api.mts` | La API de SUNAT y el trabajador que la usa; renueva el token solo |
| `sol/sesion.mts` · `formulario.mts` · `trabajador-ui.mts` | Login, menú y la vía por pantallas (respaldo) |

**Reglas de la carpeta** (las hace cumplir `pnpm lint`): archivos de **300
líneas como máximo**, y nada de sintaxis que Node no sepa correr quitando tipos
(`private` en el constructor, `enum`, `namespace`). Tests en `__tests__/`,
dentro de `pnpm test`.

## 4. Correrlo en una laptop

### Una vez

1. `pnpm install` y `npx playwright install chromium`.
2. `.env.local` en la raíz (nunca se sube: está en `.gitignore`):
   ```
   SUNAT_RUC=20512201611
   SUNAT_SOL_USUARIO=<usuario secundario de SOL, el «ampliado»>
   SUNAT_SOL_CLAVE=<su clave>
   SUPABASE_URL=https://vqabgnynidehfqueupki.supabase.co
   SUPABASE_ANON_KEY=<clave publicable>
   ROBOT_CORREO=<usuario robot>
   ROBOT_CLAVE=<clave del robot>
   GOOGLE_SA_EMAIL=<correo de la cuenta de servicio>
   GOOGLE_DRIVE_FOLDER_ID=<carpeta raíz de las hojas>
   GOOGLE_SA_KEY_FILE=secrets/sa.json
   ```
3. El JSON de la cuenta de servicio de Google en `secrets/sa.json` (también
   ignorado por git). Se acepta tal cual lo entrega Google.

### Los comandos (bash + pnpm)

```bash
# ¿Funciona la API hoy? 12 pendientes de muestra, no guarda nada (1-2 min)
pnpm cpe:sondeo

# Lo nuevo de agosto y septiembre (por omisión), 8 a la vez
pnpm cpe:local

# Otros meses; lo más reciente primero (si hay que cortar, lo último queda completo)
WORKERS=8 ORDEN=reciente PERIODO=202603,202604,202605 pnpm cpe:local

# Rellenar el PDF de lo que ya está guardado sin PDF (todos los meses)
MODO=pdf WORKERS=4 PERIODO=todos pnpm cpe:local

# Cómo van las corridas de hoy (desde otra terminal, no las toca)
pnpm cpe:estado

# Qué tienen las hojas publicadas
pnpm cpe:hojas
```

**Una sola corrida por mes a la vez.** Dos corridas sobre los mismos meses se
pisan el trabajo. Sobre meses distintos sí se pueden correr juntas, pero
comparten el cupo de Drive: no van más rápido que una sola con más `SUBIDAS`.
**Nunca a la vez que un workflow de SOL** (descargar, extraer, individual o
este mismo en GitHub).

**Cortar a la mitad:** Ctrl+C **una vez** termina lo que está en curso, sube y
guarda lo ya bajado. Lo que falte queda pendiente y la próxima corrida lo toma
sola. Un segundo Ctrl+C sale en seco (lo bajado igual queda en `salida/cpe/`).

**Dejarla corriendo sola:** laptop enchufada, tapa abierta y la suspensión de
Windows en «Nunca». Si se suspende, la corrida se congela.

### Variables

| Variable | Por omisión | Qué hace |
|---|---|---|
| `PERIODO` | `202608,202609` | Meses `yyyymm` separados por coma, o `todos` |
| `MODO` | `nuevos` | `nuevos` = lo del SIRE que no está en la base · `pdf` = rellenar PDF |
| `VIA` | `api` | `ui` = por pantallas (respaldo, lento) |
| `WORKERS` | `8` | Pedidos a SUNAT en paralelo |
| `LIMITE` | `0` | Cuántos procesar (0 = todos) |
| `ORDEN` | `antiguo` | `reciente` = lo más nuevo primero |
| `SUBIDAS` · `PDF_EN_PARALELO` | `6` · `6` | Paralelo en Drive y en PDF |
| `MAX_INTENTOS` · `ESPERA_CAIDO_S` | `6` · `30` | Reintentos por comprobante y espera tras un 500 |
| `LOTE_GUARDADO` | `20` | Cada cuántos se guarda en Supabase |
| `PUBLICAR` | `fin` | `nunca` = no republicar la hoja de detalle al final |
| `HEADLESS` · `BARRA` | `1` · `1` | `0` = ver el navegador · `0` = sin barra de progreso |

## 5. Qué mirar

**En la terminal:** abajo, la barra; arriba, los logs de siempre.
```
[██████████░░░░░░]  40% 950/2362 guardados · SUNAT listo · 1400 en PDF/Drive · 0 por reintentar · 80/min · ETA 17m40s · 12m03s
```
«Guardados» = terminado de punta a punta (en Supabase). Que diga «SUNAT listo»
con la barra a medias es normal: Drive es más lento que SUNAT.

**Cuando una etapa termina**, el log lo dice:
`✔ Drive terminada a los 31m de empezar (26m de trabajo): ok 2339, fallidos 3`.

**`pnpm cpe:estado`**: cada etapa con sus números (ok, fallidos, en cola) y si
la corrida sigue viva (sale `¿DETENIDA?` si pasó más de 90 s sin latido).

**En `logs/cpe-api-<fecha>/`** (una carpeta por corrida):

| Archivo | Qué tiene |
|---|---|
| `eventos.jsonl` | Todo lo que salió por consola, con datos extra |
| `intentos.jsonl` | Un renglón por pedido a SUNAT: clase, estado HTTP, ms, cuerpo crudo si falló |
| `http.jsonl` | Toda respuesta HTTP ≥ 400, con el cuerpo tal cual |
| `estado.json` | El estado por etapa (se reescribe cada 30 s) |
| `resumen.json` | Al final: totales por etapa, por clase y por código HTTP |
| `agotados.jsonl` | Los que fallaron 6 veces (siguen pendientes: la próxima corrida los reintenta) |
| `pdf-faltantes.jsonl` | Guardados sin PDF (para `MODO=pdf`) |
| `subidas-fallidas.jsonl` | Lo que no subió a Drive (quedó en `salida/cpe/<mes>/`) |

`logs/cpe-no-existe.jsonl` (fuera de las carpetas, acumulado): lo que SUNAT
dijo que no existe. No se vuelve a pedir salvo con `REINTENTAR_NO_EXISTE=1`.

## 6. Errores y qué hace con cada uno

| Clase | Qué es | Qué hace |
|---|---|---|
| `SUNAT_CAIDO` | HTTP 5xx («There was an error processing your request») | Al final de la cola, 30 s después. Si más del 80% de los últimos 2 min fue esto, **todos** pausan 2 min |
| `TIMEOUT` | SUNAT no respondió en 30 s | Reintenta con espera creciente |
| `SESION` | 401/403: token vencido | Renueva el token (reabre la pantalla una vez) y reintenta sin gastar intento |
| `LIMITE` | 429: demasiado rápido | Espera 1 min × intento |
| `NO_EXISTE` | 404, o SUNAT dice que no está | Se anota y no se vuelve a pedir |
| Drive «User rate limit» / 5xx | Cupo de Google | 5 reintentos espaciados; si no, queda en disco y pendiente |

**Conocido al 30/09/2026:**
- El RUC **20100047218** (series FE01/FI01/FN01/FC03) da 500 siempre por API:
  11 agotados en ago+sep. Pendiente probar esos por pantalla (`VIA=ui`).
- El PDF da 500 mucho más que el XML; por eso tiene su cola con 4 intentos
  (0, 3, 10, 30 s) y, si igual falla, el XML se guarda solo.
- La lista masiva por rango de fechas (`…/comprobantes/{ruc}-{tipo}-2?fecEmisionIni=…`)
  responde 404 con los parámetros probados. No hace falta hoy.

## 7. En GitHub Actions

Workflow **«SUNAT CPE por API»** (`.github/workflows/sunat-cpe-api.yml`), el
mismo script:
- **Cron 8:30 (Lima)**: mes anterior + actual, lo más reciente primero.
  Tomó el horario de «SUNAT consultar CPE individual», que queda **solo manual**
  como respaldo por pantallas.
- **A mano** (Actions → SUNAT CPE por API → Run workflow): `periodo` (vacío =
  anterior + actual, o `todos`), `modo` (`nuevos`/`pdf`), `workers`, `limite`, `via`.
- Comparte el grupo de `concurrency` con el workflow viejo: nunca corren a la vez.
- Al final imprime el estado por etapa; las bitácoras quedan como artefacto
  `bitacoras-cpe-api` (14 días).
- Usa los mismos secretos que los otros workflows (guía, §5.1).

## 8. Las estrategias que hicieron la diferencia

En orden de impacto, con lo que se midió el 30/09/2026:

1. **Ir a la fuente en vez de a la pantalla.** Se leyó el código público de la
   app de SUNAT (el `main.*.js` que baja el navegador) y ahí estaban las rutas de
   su API. Una petición de ~300 ms reemplazó a 6 clics de menú + formulario +
   espera + modal (20-30 s). Es el salto de ~100×.
2. **Saltarse el paso que falla.** El «Error del Servidor» venía de la consulta
   de cabecera, no de la descarga. Ir directo al XML convirtió en éxito lo que
   por pantalla fallaba siempre.
3. **Medir antes de correr (`pnpm cpe:sondeo`).** Probar todas las vías sobre la
   misma muestra, sin guardar nada, mostró en 2 minutos que el `fetch` de Node
   estaba bloqueado, que el cliente de Playwright pasaba, cuánto aguantaba el
   paralelo (474/min con 8) y que el PDF falla más que el XML.
4. **Paralelo con colas por etapa.** 8 pedidos a SUNAT a la vez, y cada etapa
   (SUNAT → PDF → Drive → Supabase) con su propia cola y su propio paralelo:
   nadie espera al más lento. Sacar el PDF del turno del trabajador subió el
   ritmo de SUNAT de 16/min a ~470/min.
5. **Reintentar con inteligencia, no con fuerza.** Lo que falla vuelve al final
   de la cola (30 s) y el trabajador sigue con otro; SESION no gasta intentos;
   si casi todo falla, pausa general en vez de martillar. Resultado ago+sep:
   1 114 errores 500 en el camino y solo 11 comprobantes perdidos (todos de un
   mismo proveedor).
6. **Nada se pierde.** Respaldo en disco antes de Drive, guardado en lotes de 20
   (no al final), `guardar_cpe` idempotente y archivos de Drive reconocidos por
   nombre: cortar y volver a correr es siempre seguro.
7. **Logs crudos para diagnosticar, no para adivinar.** Cada error HTTP con su
   cuerpo tal cual, cada intento con su clase y sus tiempos. Así se vio en
   minutos que el «logout» era falso, que el `fetch` fallaba por
   `UND_ERR_SOCKET` y que los agotados eran todos de un RUC.
8. **Ver cada etapa por separado.** La barra cuenta lo guardado (no lo
   consultado) y `pnpm cpe:estado` dice qué etapa terminó: sin eso, «100%» con
   25 minutos de Drive por delante parecía un cuelgue.
9. **Código chico y probado.** Archivos ≤ 300 líneas, tests de lo puro
   (clasificación, reintentos, colas con trabajadores falsos) y un lint que
   atrapa la sintaxis que rompía la ejecución en Node.

## 9. Pendientes (al 30/09/2026, 13:20)

| # | Qué | Cómo |
|---|---|---|
| 1 | **Terminar marzo–julio** si la corrida de hoy no alcanzó a subir todo a Drive | Volver a correr el mismo comando (§10): toma solo lo que no está en la base |
| 2 | **Enero y febrero** no-E001 (~1 600) | §10, paso 2 |
| 3 | **Rellenar PDF** de lo guardado sin PDF | `MODO=pdf` (§10, paso 3) |
| 4 | **RUC 20100047218** (FE01/FI01/FN01/FC03): 500 siempre por API | Probar por pantallas: `VIA=ui WORKERS=1 PERIODO=… pnpm cpe:local` |
| 5 | **Agotados de marzo–julio** (59) | Se reintentan solos en la próxima corrida; si vuelven a agotarse, revisar si son del mismo RUC |
| 6 | **E001 de enero** (180, nunca bajados) | Workflow «SUNAT extraer rango» 01/01–31/01, o extender este script a serie E |
| 7 | **Validar el workflow en GitHub** | Actions → SUNAT CPE por API → Run workflow con `limite` 5. Si SUNAT bloquea los servidores de GitHub, volver a correr desde una laptop |
| 8 | **Drive es el cuello (~70-80/min)** | Ideas: subir a Drive después de guardar en la base (que la hoja no espere a Drive), o más `SUBIDAS` hasta que aparezca «User rate limit» |
| 9 | **Llevar las mismas estrategias** a «descargar XML», «extraer rango» y «padrón de RUC» | Colas por etapa, sondeo previo, logs crudos |
| 10 | **Aplicar la migración 043** (lecturas de cpe_comprobante sin timeout) | Supabase → SQL Editor → pegar `db/migrations/043_…sql` → Run. Mientras tanto el script lee lo guardado vía `detalle_cpe` y funciona igual |
| 11 | **Hoja «COBERTURA»** desactualizada y cortada en 1 000 filas | Es de la app web (límite de PostgREST) |

## 10. Para continuar en otra laptop (entrega del 30/09/2026)

**Antes de empezar:** que no haya ninguna otra corrida viva con la misma cuenta
de SOL (ni en otra laptop ni en GitHub Actions). Pedir por un canal privado —
**nunca por git ni por chat público**— el `.env.local` y `secrets/sa.json`, y
ponerlos en la raíz del repo (§4).

```bash
git pull
pnpm install
npx playwright install chromium

# 0. ¿La API responde hoy? (1-2 min, no guarda nada)
pnpm cpe:sondeo

# 1. Terminar marzo–julio (si ya está todo, dice «pendientes: 0» y sale)
WORKERS=8 ORDEN=reciente PERIODO=202603,202604,202605,202606,202607 pnpm cpe:local

# 2. Enero y febrero
WORKERS=8 ORDEN=reciente PERIODO=202601,202602 pnpm cpe:local

# 3. Rellenar los PDF que falten (todos los meses)
MODO=pdf WORKERS=4 PERIODO=todos pnpm cpe:local

# En cualquier momento, desde otra terminal
pnpm cpe:estado
```

- Uno después del otro, no a la vez (comparten el cupo de Drive).
- Cada uno termina con un resumen y `✔ … terminada` por etapa; los números
  quedan en `logs/cpe-api-<fecha>/resumen.json`.
- **Cortar**: Ctrl+C una vez = deja de pedir a SUNAT y **espera a que Drive y la
  base terminen lo ya bajado** (puede ser largo si hay mucho en cola). Ctrl+C
  dos veces = sale ya; lo bajado queda en `salida/cpe/` y lo que no llegó a la
  base se vuelve a pedir en la próxima corrida. En los dos casos no se pierde
  nada ni se duplica.
