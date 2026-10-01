# Guía del repositorio — dónde está cada cosa

> Punto de entrada para cualquier persona (o asistente de IA) que llegue a
> este repositorio. Explica qué hay, dónde corre, qué credenciales usa, cómo
> se verifica que funciona y dónde están los documentos de detalle.
>
> **Vigente al 30/09/2026.** Los números de la sección 11 son una foto de ese
> día; la sección 12 dice cómo sacarlos de nuevo.

---

## 0. Antes de empezar: el contexto que existe

| Archivo | Qué es |
|---|---|
| `CLAUDE.md` | Instrucciones que lee Claude Code al abrir el repo. Solo incluye `AGENTS.md` y apunta a esta guía. |
| `AGENTS.md` | Aviso que **genera `next dev` solo** (la versión de Next.js tiene cambios de API: leer `node_modules/next/dist/docs/` antes de tocar la app). No editarlo a mano: se regenera. |
| **`GUIA-DEL-REPOSITORIO.md`** | Este archivo: el índice general. |
| `README.md` | Apunta a esta guía. |

---

## 1. Qué es este repositorio

Son **dos sistemas** que comparten base de datos (Supabase) y Google Drive:

1. **INRO VIÁTICOS — la aplicación web** (Next.js, desplegada en Vercel).
   Memos de viáticos, rendiciones con foto del comprobante + extracción por
   IA, caja chica, planillas de movilidad, liquidaciones y el cruce contra
   SUNAT. Proceso de negocio completo en `docs/proceso-viaticos.md`.

2. **El pipeline de comprobantes SUNAT — automatización** (GitHub Actions +
   Playwright). Trae de SUNAT el registro de compras (SIRE), baja el XML/PDF
   de cada comprobante, lo archiva en Drive, guarda el detalle de ítems en la
   base y publica las hojas que usa Contabilidad. Encima de eso, el cruce con
   las **órdenes de compra (OC)** y sus centros de costo.

Empresa: **INDUSTRIAS ROLAND PRINT S.A.C. — INROPRIN**, RUC `20512201611`.

---

## 2. Mapa de carpetas

```
.github/workflows/   Los 6 workflows de SUNAT (ver sección 4)
scripts/             Lo que corren esos workflows (Node + Playwright)
  local/             Pipeline de CPE por la API de SUNAT: laptop y «SUNAT CPE por API»
                     (docs/pipeline-cpe-local.md)
app/                 La aplicación web (Next.js, App Router)
  (app)/             Pantallas con sesión: memos, revisar, caja, movilidad,
                     liquidaciones, contabilidad, tablero, sistema/sunat…
  acciones/          Server actions (lo que las pantallas le piden al servidor)
  api/               3 endpoints: extraer (IA), drive-upload, memo-word
  ingresar/          Login
components/          Componentes de React
lib/                 Lógica compartida por la app Y los scripts (sección 9)
  dominio/           Reglas de negocio de viáticos (con tests)
  sunat/             Token, SIRE, lectura de XML, catálogo de consultas
  export/            Armado de las hojas (COMPROBANTES SUNAT, DETALLE…)
  drive/             Escritura en Drive y publicación de hojas
  ocr/ extraccion/   Lectura de comprobantes: Tesseract en el navegador + Gemini
  supabase/          Clientes de la base (navegador y servidor)
  word/              Generación del memo en .docx
db/migrations/       43 migraciones SQL, en orden (001 → 043)
db/database.full.sql Todas las migraciones en un archivo (GENERADO: pnpm db:consolidar)
db/carga/            Carga inicial del padrón de personas
docs/                Documentos de detalle (sección 13)
docs/appscript/      Código de Google Apps Script (se pega a mano en cada hoja)
public/              Estáticos de la app
```

---

## 3. Dónde corre cada cosa

| Pieza | Dónde vive | Cómo se despliega |
|---|---|---|
| App web | **Vercel**, proyecto `foto-grama` (`foto-grama.vercel.app`) | Automático al hacer push a `main` |
| Automatización SUNAT | **GitHub Actions** de este repo | El workflow se lee de `main` en cada corrida |
| Base de datos | **Supabase**, proyecto `vqabgnynidehfqueupki` | Migraciones de `db/migrations/` aplicadas a mano, en orden |
| XML y PDF de comprobantes | **Google Drive**, carpeta `SUNAT_DRIVE_FOLDER` → `Recibidas/AAAA-MM`, `Emitidas/AAAA-MM` | Los sube la cuenta de servicio |
| Hojas publicadas | **Google Drive**, carpeta `GOOGLE_DRIVE_FOLDER_ID` → `SUNAT/` | Se reescribe la pestaña de datos en cada corrida |
| Tableros y captura de OC | **Google Apps Script**, pegado en cada hoja | A mano (instrucciones en `docs/appscript/README.md`) |
| Páginas estáticas | GitHub Pages ("pages build and deployment") | Automático |

**Por qué la automatización está en GitHub Actions y no en Vercel:** un cron
de Vercel muere al minuto, y SUNAT tarda entre 1 y 3 minutos en responder un
ticket del SIRE (y horas para confirmar comprobantes uno por uno). Apps Script
tampoco sirve: no puede manejar un navegador, y las pantallas de SOL lo exigen.

---

## 4. Los workflows (GitHub Actions)

Todos están en `.github/workflows/`. Todos se pueden correr a mano desde la
pestaña **Actions** → elegir el workflow → **Run workflow**. Todos suben un
artefacto `capturas-*` con capturas de pantalla y HTML de cada paso (7 días),
que es la evidencia para diagnosticar cuando algo falla.

### 4.1 Horario diario (hora de Lima, UTC-5)

| Hora | Workflow | Qué hace |
|---|---|---|
| 02:00 | **Carpetas de OC (nacionales e importaciones)** | Lee los nombres de las carpetas madre de compras nacionales e importaciones (OC y comprobantes) |
| 08:00 | **SUNAT diario** | Pide al SIRE la lista de compras (mes actual y anterior) |
| 08:00 | **SUNAT descargar XML** | Baja XML/PDF de serie **E001** de ayer y hoy |
| 08:30 | **SUNAT CPE por API** | Baja XML y PDF de los **no-E001** directo de la API de SUNAT (mes anterior + actual, todos los pendientes) |
| 09:00 | **SUNAT padrón de RUC** | Consulta la condición de los RUC nuevos o vencidos |
| —     | *(a mano)* consultar CPE individual | Respaldo por pantallas, sin cron desde el 30/09/2026 |

### 4.2 Ficha de cada workflow

#### SUNAT diario — `sunat-diario.yml` → `scripts/sunat-diario.mts`
- **Qué hace:** pide por la **API del SIRE** (no navegador) la propuesta del
  Registro de Compras del mes en curso y el anterior —el anterior porque los
  proveedores siguen declarando semanas después del cierre—. Guarda cada
  comprobante en `comprobantes_sunat` (cabecera: RUC, serie, número, montos,
  IGV, detracción) y publica la hoja **COMPROBANTES SUNAT**.
- **Es la fuente de la verdad de "qué existe".** No baja XML ni PDF.
- **Trae todas las series** (E001, F001, FC01…). Es lo que agrega los
  pendientes nuevos cada mañana.
- **Cuándo:** cron 08:00 + manual (`periodos`, `solo_publicar`). Tope 25 min.
- **Credenciales:** `SUNAT_INROPRIN_CLIENT_ID/_CLIENT_SECRET/_USUARIO/_CLAVE`
  (API del SIRE), robot de la base, cuenta de servicio de Google.
- Detalle: `docs/cron-sunat.md`.

#### SUNAT descargar XML — `descargar-cpe.yml` → `scripts/descargar-cpe.mts`
- **Qué hace:** entra a SOL con Playwright, usa las pantallas de consulta **por
  rango de fechas** («Consultar Factura y Nota», «Consultar Boleta de Venta y
  Nota»), baja XML y PDF, los archiva en Drive y guarda el detalle de ítems
  en `cpe_comprobante` / `cpe_item`. Publica **COMPROBANTES SUNAT - DETALLE**.
- **Limitación estructural:** esa pantalla **solo ve serie E001**. No es un
  bug: es el portal. Por eso existe el workflow siguiente.
- **Cuándo:** cron 08:00 con ventana de **ayer y hoy** (una ventana ancha
  diaria reventaba el límite de solicitudes de SUNAT) + manual con rango.
  Tope 120 min.
- **Tipos:** los 10 del catálogo `lib/sunat/cpe-consulta.ts` (FE/NC/ND
  emitidas y recibidas; BVE/NC-BVE/ND-BVE).
- Detalle: `docs/descarga-cpe-y-detalle-de-items.md`,
  `docs/scraper-cpe-hallazgos-tecnicos.md`.

#### SUNAT extraer rango (hoja aparte) — `extraer-cpe-rango.yml` → `scripts/descargar-cpe.mts`
- **Qué hace:** el mismo motor que el anterior, pero para **rellenar meses
  completos a mano**: parte el rango por mes y deja además una hoja con solo
  esos meses («COMPROBANTES SUNAT - DETALLE 2026-08 a 2026-09»).
- **Cuándo:** solo manual. Tope 330 min.
- Detalle: `docs/extraer-boletas-y-rangos-largos.md`.

#### SUNAT CPE por API — `sunat-cpe-api.yml` → `scripts/local/cpe.mts`
- **Qué hace:** lo mismo que el siguiente, pero sin pantallas: entra a SOL una
  vez, toma el token de la app «Nueva Consulta» y baja XML y PDF directo de
  `api-cpe.sunat.gob.pe`, 8 a la vez. ~300 ms por XML y ~88% a la primera (el
  resto se reintenta). Colas separadas SUNAT → PDF → Drive → Supabase, con el
  estado de cada etapa. **Es el mismo script que se corre en una laptop.**
- **Cuándo:** cron 08:30 (mes anterior + actual) + manual (`periodo`, `modo`
  nuevos/pdf, `workers`, `limite`, `via`). Tope 180 min.
- Detalle, comandos locales y diagnóstico: **`docs/pipeline-cpe-local.md`**.

#### SUNAT consultar CPE individual — `consultar-cpe-individual.yml` → `scripts/consultar-cpe-individual.mts`
- **Respaldo desde el 30/09/2026, solo manual**: el cron lo tomó el de arriba.
- **Qué hace:** para cada comprobante **no-E001** que el SIRE dice que existe
  y que todavía no está en `cpe_comprobante`, entra a SOL → «Nueva Consulta de
  comprobantes de pago», llena RUC + tipo + serie + número, abre el modal
  «Resultado», baja XML y PDF, los archiva en Drive y guarda el detalle.
  Guarda y republica la hoja de detalle **cada 20 confirmados**.
- **Cuándo:**
  - **Cron 08:30:** mes anterior + actual, **lo más reciente primero**, 100 por día.
  - **Manual:** `periodo` (por omisión `202609`, admite varios separados por
    coma; vacío = **todos**, ojo que incluye el backlog desde enero),
    `orden` (`antiguo`/`reciente`), `limite` (por omisión 3), `debug`
    (por omisión **true**: no guarda nada, solo captura).
- **Nunca dos a la vez** (`concurrency`): comparten la cuenta de SOL y una
  segunda sesión puede hacer que SUNAT cierre la primera. La segunda espera.
- **Tiempo:** ~20-30 s por comprobante si SUNAT responde bien; bastante más
  cuando SUNAT está inestable. Tope 180 min → lotes de hasta ~150.
- **Tipos:** factura (01), nota de crédito (07), nota de débito (08). Desde el
  29/09/2026 el desplegable de SUNAT junta la nota con lo que modifica
  («Factura - Nota de Crédito» / «Boleta de Venta - Nota de Crédito»); el
  script elige por el prefijo de la serie (F→Factura, B→Boleta).

#### SUNAT padrón de RUC — `consultar-padron-ruc.yml` → `scripts/consultar-padron-ruc.mts`
- **Qué hace:** consulta la **Consulta RUC pública** (con reCAPTCHA v3, por eso
  navegador) para saber si cada proveedor es Buen Contribuyente o Agente de
  Retención/Percepción. Guarda en `padron_ruc`. Solo consulta RUC nuevos o con
  más de 30 días.
- **Cuándo:** cron 09:00 + manual. Tope 30 min. No necesita Clave SOL.

#### Carpetas de OC (nacionales e importaciones) — `carpetas-oc.yml` → `scripts/carpetas-oc.mts`
- **Qué hace:** recorre la carpeta madre de compras nacionales
  («5. Ordenes de Compra», compartida como Lector con la cuenta de servicio)
  **solo por nombres**, sin descargar: de cada carpeta «OC 2026 - 0200
  PROVEEDOR - PROYECTO» saca la OC, y de cada archivo qué parece (factura,
  XML, guía…) y la serie del comprobante (`lib/drive/carpetas-oc.ts`, la
  misma regla que `LegajoPorOC.gs`). Sube a `oc_carpeta` y a `oc_archivo`
  con origen `CARPETA` (migración 045), que `vinculos_oc()` usa para unir
  cada factura de SUNAT con su OC. Publica la hoja «OC - CARPETAS COMPRAS
  NACIONALES» (pestañas de OC y de ARCHIVOS) en la carpeta SUNAT.
- **Lectura por dentro:** lo que el nombre no explica («scan001.pdf»,
  «WhatsApp Image…», «FACTURA LUCY.pdf» sin número, «INVOICE», XML o ZIP sin
  serie) se baja y se lee: el XML/ZIP exacto, el texto del PDF (`pdftotext`)
  o, si es escaneo o foto, OCR (`tesseract`, español e inglés). Saca tipo,
  serie-número, RUC del emisor (validado con su dígito verificador) y la OC
  que cita el XML (`lib/drive/lectura.ts`, la misma regla que el OCR de
  `LegajoPorOC.gs`). Cada archivo se lee una vez: queda en `lectura_archivo`
  (migración 048) y solo se relee si cambió o si dio error. Cada noche hasta
  3000 archivos / 45 min (nacionales) y 30 min (importaciones); lo que no
  alcance sigue la noche siguiente. En el cruce cuenta como «Lectura del
  documento», la fuente más segura. Detalle en `lecturas.csv` y en las
  columnas «Leído por dentro» de la pestaña ARCHIVOS.
- **Legajo y centro de costo:** de cada OC dice qué documentos tiene y cuál
  le falta (la regla de `LegajoPorOC.gs`: factura; guía si es bien; acta si
  es servicio; DAM si es importación) y le pone centro de costo: el de la OC
  en CG (o en el cuadro, si es importación) y, si no está, el de su carpeta
  de proyecto (`lib/drive/legajo-carpeta.ts`; lo administrativo, por ahora,
  al área administrativa general). La regla por carpeta queda en
  `proyecto_centro_costo` y en la pestaña CENTRO DE COSTO; una fila con
  fuente `MANUAL` (corregida por Contabilidad) no se pisa (migración 049).
- **Cambios:** en cada corrida completa compara con la anterior y anota en
  `carpeta_cambio` (pestaña CAMBIOS, 60 días) las OC nuevas o que ya no
  están, los archivos nuevos, eliminados, modificados o renombrados, y las
  OC que se completaron o a las que ahora les falta algo.
- **En una computadora:** `pnpm carpetas:local` (ver
  `docs/carpetas-oc-local.md`): la carga pesada sin gastar minutos de GitHub;
  se corta y continúa donde quedó.
- **Importaciones:** el mismo script con `PROCEDENCIA=importacion` lee la
  carpeta de importaciones; ahí la OC va con 3 dígitos («172-2026», como en
  el cuadro de aprobaciones), se compara contra el legajo del cuadro en vez
  de CG y publica «OC - CARPETAS IMPORTACIONES». Cada carpeta madre reemplaza
  solo lo suyo (migración 046).
- **Cuándo:** cron 02:00 (completa, de verdad) + manual. A mano arranca en
  depuración (no toca la base ni la hoja); se elige nacionales, importaciones
  o ambas, y nacionales se puede limitar a un proyecto (`subcarpeta`). El resumen queda en la página de la corrida; los CSV, en el
  artefacto `carpetas-oc`. Solo una corrida completa y sin fallas reemplaza
  lo anterior; una parcial solo suma.

#### Otros scripts
- `scripts/sire.mts`: prueba la cadena del SIRE **desde una máquina local**
  (`token`, `propuesta 202607`). No lo usa ningún workflow.

---

## 5. Credenciales — qué hay, dónde se configura, quién la usa

**Ninguna credencial está en el repositorio** (es público). Aquí van solo los
**nombres**; los valores están donde dice la columna "Dónde".

### 5.1 Secretos de GitHub Actions
*Settings → Secrets and variables → Actions*

| Secreto | Qué es | Lo usan |
|---|---|---|
| `SUPABASE_URL` / `PROJECT_URL` | URL del proyecto Supabase (se aceptan los dos nombres) | todos |
| `SUPABASE_ANON_KEY` / `ANON_KEY` | Clave publicable de Supabase | todos |
| `ROBOT_CORREO` / `ROBOT_CLAVE` | Usuario "robot" de la base; los scripts entran con él, así la bitácora dice quién escribió | todos |
| `SUNAT_RUC` | RUC de la empresa (por omisión 20512201611) | descargar, extraer, individual |
| `SUNAT_INROPRIN_CLIENT_ID` / `_CLIENT_SECRET` | Credenciales de la **API** de SUNAT (SIRE) | diario (y descargar/extraer, el ID) |
| `SUNAT_INROPRIN_USUARIO` / `_CLAVE` | Usuario secundario de Clave SOL de la API | diario; respaldo de los demás |
| `SUNAT_SOL_USUARIO` / `SUNAT_SOL_CLAVE` | Usuario secundario de Clave SOL **ampliado** (ve boletas y la consulta individual). Si falta, los scripts caen a los `SUNAT_INROPRIN_*` | descargar, extraer, individual |
| `SUNAT_DRIVE_FOLDER` | Carpeta de Drive donde se archivan XML/PDF (tiene valor por omisión en el código) | descargar, extraer, individual |
| `GOOGLE_SA_EMAIL` / `GOOGLE_SA_PRIVATE_KEY` | Cuenta de servicio de Google (Drive y Sheets) | todos menos padrón |
| `GOOGLE_DRIVE_FOLDER_ID` | Carpeta raíz donde se publican las hojas. Si falta, se guarda igual y solo se salta la hoja | todos menos padrón |

### 5.2 Variables de entorno de Vercel (la app)
*Vercel → proyecto foto-grama → Settings → Environment Variables*

| Variable | Qué es |
|---|---|
| `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `GOOGLE_DRIVE_FOLDER_ID` | Igual que arriba (plantilla en `.env.local.example`) |
| `GEMINI_API_KEYS` (o `GEMINI_API_KEY`) | Claves de Gemini para leer comprobantes; varias separadas por coma, se rotan (`lib/extraccion/pool-claves.ts`) |
| `SUNAT_{EMP}_CLIENT_ID`, `_CLIENT_SECRET`, `_USUARIO`, `_CLAVE` | Credenciales SUNAT por empresa; `{EMP}` es la abreviatura guardada en `empresas.sunat_secret_ref` (hoy `INROPRIN`). Ver `lib/sunat/credenciales.ts` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Opcionales: si no están, se usan los valores de `lib/supabase/config.ts` (no son secretos: la seguridad la dan las políticas de fila) |

### 5.3 Propiedades de Apps Script
*En cada hoja: Extensiones → Apps Script → ⚙ Configuración → Propiedades del script*

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ROBOT_CORREO`, `ROBOT_CLAVE`, y según
el script `RUC_EMPRESA`, `CARPETA_RAIZ`. Los `LEGAJO_*` los escribe el propio
script (estado interno, no se configuran).

### 5.4 Local
`.env.local` (ignorado por git). Plantilla: `.env.local.example`.

---

## 6. La base de datos (Supabase)

Proyecto `vqabgnynidehfqueupki`. **Todas las tablas tienen RLS**: los scripts y
Apps Script entran como el usuario robot; la app, como la persona.

### 6.1 Tablas principales (filas aproximadas al 30/09/2026)

**Viáticos (la app)**

| Tabla | Filas | Qué guarda |
|---|---:|---|
| `usuarios` / `roles_usuario` | 157 / 136 | Personas y sus roles |
| `datos_bancarios` | 69 | Banco, cuenta y CCI de cada persona |
| `memos` / `memo_asignados` | 204 / 486 | Memos y a quién cubre cada uno |
| `gastos` | 5 | Comprobantes rendidos en la app |
| `liquidaciones`, `pagos`, `cajas_chicas`, `planillas_movilidad`, `solicitudes_memo`, `devoluciones` | casi vacías | Flujos listos, con poco uso real todavía |
| `centros_costo`, `areas`, `empresas`, `parametros` | 38, 17, 1, 7 | Catálogos |

**SUNAT**

| Tabla | Filas | Qué guarda | La llena |
|---|---:|---|---|
| `comprobantes_sunat` | 13 736 | Cabeceras del SIRE: **lo que existe** | sunat-diario |
| `cambios_comprobante_sunat` | 3 | Cuando SUNAT cambia un comprobante ya visto | sunat-diario |
| `consultas_sunat` | 56 | Bitácora de consultas al SIRE | sunat-diario, app |
| `cpe_comprobante` | 4 379 | Cabecera leída del **XML**, con enlace a XML y PDF en Drive | descargar, individual |
| `cpe_item` | 7 576 | **Detalle de ítems** de cada comprobante | descargar, individual |
| `cpe_cuota` | 209 | Cuotas de pago a crédito | descargar, individual |
| `padron_ruc` | 1 586 | Condición de cada RUC proveedor | padrón |

**Órdenes de compra (OC)**

| Tabla | Filas | Qué guarda | La llena |
|---|---:|---|---|
| `oc_archivo` | 10 530 | Cada archivo encontrado en las carpetas de OC de Drive | Apps Script `SubirCapturaOC.gs` |
| `oc_base_cg` | 3 723 | Centro de costo de cada OC según Control de Gestión | ídem |
| `oc_legajo` | 506 | Legajo por OC | Apps Script `SubirLegajo.gs` |
| `oc_carpeta` | 1 433 | Cada carpeta de OC de las carpetas madre (nacionales e importaciones) | `carpetas-oc` (también sube a `oc_archivo` con origen `CARPETA`) |
| `lectura_archivo` | — | Lo leído por dentro de cada archivo (XML, PDF, OCR), para no leerlo dos veces | `carpetas-oc` |
| `proyecto_centro_costo` | — | Centro de costo de cada carpeta de proyecto (para OC que no están en CG); `MANUAL` no se pisa | `carpetas-oc`, Contabilidad |
| `carpeta_cambio` | — | Qué cambió en las carpetas madre entre dos corridas completas | `carpetas-oc` |
| `equivalencia_centro_costo` | 2 | Centro de costo → código CONCAR, **solo lo confirmado** | a mano |

### 6.2 Funciones clave (en las migraciones)

| Función | Qué hace | Migraciones que la tocan |
|---|---|---|
| `guardar_cpe(p_empresa_ruc, p_docs)` | Guarda comprobante + ítems; idempotente (repetir actualiza, no duplica) | 032 a 036 |
| `historico_comprobantes_sunat(p_periodo)` | Filas de la hoja **COMPROBANTES SUNAT** | 017, 039, 041, 042 |
| `detalle_cpe(p_periodo)` | Filas de la hoja **COMPROBANTES SUNAT - DETALLE** | 032 a 036, 039, 041, 042 |
| `detalle_cpe_carpeta(p_periodo)` | `detalle_cpe` + proyecto, de dónde sale el centro de costo y documentos de la carpeta madre (lo que publica el DETALLE) | 051 |
| `legajo_de_carpetas(p_empresa_ruc)` | Una fila por carpeta de OC de las carpetas madre, para la pestaña CARPETA MADRE de GENERAL (`CarpetaMadre.gs`) | 051 |
| `vinculos_oc()` | Cruza comprobantes con archivos de las carpetas de OC | 039, 040, 042, 045, 046, 048, 049, 050 |
| `cargar_captura_oc(...)` | Recibe la captura de OC desde Apps Script | 039, 042 |

La versión vigente de cada función es la de la **última** migración que la toca.

### 6.3 Migraciones
`db/migrations/NNN_nombre_descriptivo.sql`, **en orden, sin saltarse
ninguna**. Cada una explica en su encabezado por qué existe. La última es
`043_lectura_de_cpe_sin_evaluar_por_fila.sql` (pendiente de aplicar al 30/09/2026). Se aplican a mano (editor SQL de Supabase) y se
versionan acá.

---

## 7. Las hojas de Google que se publican

Todas en `GOOGLE_DRIVE_FOLDER_ID/SUNAT/`. Se reescribe solo la pestaña de
datos: los tableros que alguien arme en otras pestañas del mismo archivo no se
tocan.

| Hoja | Una fila por | La publican | Columnas destacadas |
|---|---|---|---|
| **COMPROBANTES SUNAT** | comprobante (SIRE) | sunat-diario, app | montos, condición del RUC, OC, centro de costo, código CONCAR, alertas, archivo que confirma la OC |
| **COMPROBANTES SUNAT - DETALLE** | ítem (XML) | descargar, individual, app | descripción, cantidad, precio, enlaces a PDF/XML, forma de pago, detracción, OC, archivo que confirma la OC |
| **… DETALLE AAAA-MM a AAAA-MM** | ítem | extraer rango | solo los meses pedidos |

Las columnas se definen en `lib/export/comprobantes-sunat.ts` y
`lib/export/items-sunat.ts` (con tests). Las nuevas se agregan **siempre al
final** para no romper referencias de quien ya usa la hoja.

---

## 8. La aplicación web

**Pantallas** (`app/(app)/`): `memos` (y `sin-asignar`), `solicitudes`,
`revisar` (aprobación), `caja` (caja chica), `movilidad`, `liquidaciones`,
`contabilidad`, `administrar` (personas), `tablero`, `sistema` y
`sistema/sunat` (consulta del SIRE y cobertura desde la app).

**Endpoints** (`app/api/`): `extraer` (lee un comprobante con Gemini),
`drive-upload` (sube la foto a Drive), `memo-word/[id]` (genera el memo .docx).

**Server actions** (`app/acciones/`): una por área (`memos.ts`, `sunat.ts`,
`historico-sunat.ts`, `items-sunat.ts`, `cruce-sunat.ts`, `legajo.ts`, …).

Permisos por rol: `lib/dominio/permisos.ts` (la matriz) y
`lib/dominio/navegacion.ts` (qué ve cada rol en el menú).

**Ojo:** `DOSSIER-TECNICO.md` describe la **versión 1** de la app (antes de
Supabase, con Google Sheets como base). Sirve como historia, no como
referencia actual.

---

## 9. `lib/` — la lógica compartida

| Carpeta | Para qué |
|---|---|
| `lib/dominio/` | Reglas de viáticos: estados, permisos, validación de comprobantes, anexo del memo, liquidación, caja chica, movilidad, pagos. **Con tests.** |
| `lib/sunat/` | `token.ts` (api-seguridad), `sire.ts`/`rce.ts` (propuesta del RCE), `cpe-xml.ts` (leer el XML UBL), `cpe-importacion.ts` (preparar el lote para `guardar_cpe`), `cpe-consulta.ts` (catálogo de consultas del portal), `consulta-ruc.ts`, `credenciales.ts`, `periodo.ts`, `zip.ts` |
| `lib/export/` | Armar las hojas: `comprobantes-sunat.ts`, `items-sunat.ts`, `cobertura-sunat.ts`, `liquidacion.ts`, `csv.ts` |
| `lib/drive/` | `servidor.ts` (subir archivos, crear carpetas, `publicarHoja`), `celdas.ts` (tipos de columna para que Sheets no adivine fechas), `rangos.ts` |
| `lib/ocr/`, `lib/extraccion/` | Leer comprobantes: Tesseract en el navegador + Gemini en el servidor, y la fusión de ambos |
| `lib/supabase/` | Clientes de la base (`cliente.ts` navegador, `servidor.ts` servidor, `config.ts`) |
| `lib/word/` | El memo en .docx, sin dependencias |

---

## 10. Google Apps Script (`docs/appscript/`)

El código vive acá versionado, pero **se ejecuta pegado en cada hoja de
Google**. Instalación de cada uno en `docs/appscript/README.md`.

| Archivo | Qué hace |
|---|---|
| `Codigo.gs` + `Tablero.html` | Tablero de comprobantes SUNAT para Contabilidad |
| `CodigoPadron.gs` + `TableroPadron.html` | Tablero SUNAT publicado como página |
| `PadronRuc.gs` | Condición del RUC dentro del Sheet |
| `Desglose.gs` | Desglose de ítems en la misma hoja |
| `VistaEjecutiva.gs` + `VistaEjecutivaPagina.html` | Vista ejecutiva del DETALLE para compartir |
| `OrdenarCPE.gs` | Script suelto, de una sola vez: ordenó en carpetas los XML que el scraper subió antes de tenerlas |
| `CapturaCarpetasOC.gs` | Recorre las carpetas de cada OC y lista sus archivos |
| `LecturaFacturas.gs` | Lee por OCR las facturas sin número en el nombre |
| `SubirCapturaOC.gs` | Sube la captura de OC a la base (`cargar_captura_oc`) |
| `LegajoPorOC.gs`, `SubirLegajo.gs`, `VistaLegajo.gs` + `TableroLegajo.html` | Legajo por OC y su tablero |

**Cómo funciona el cruce con las OC:** la captura lista los archivos de cada
carpeta de OC (con su enlace); la lectura saca RUC y serie-número del PDF
cuando el nombre no los trae; la base (`vinculos_oc()`) cruza eso con
`comprobantes_sunat` por **RUC + serie + número**. El enlace del archivo no
interviene en el cruce: se publica para poder verificarlo a mano. Si un
comprobante sale sin OC ni archivo, es que no hay nada en Drive que lo
respalde (o la captura no lo encontró).

---

## 11. Reporte de tasa de éxito (al 30/09/2026)

Hay **dos tasas distintas** y conviene no confundirlas:

- **Éxito del workflow:** la corrida terminó sin error.
- **Éxito por comprobante:** de lo que se intentó, cuánto quedó guardado.
  Un workflow puede terminar "verde" habiendo confirmado solo el 15%.

### 11.1 Por workflow (todas las corridas desde que existen)

| Workflow | Tipo | Corridas | OK | % | Duración típica |
|---|---|---:|---:|---:|---|
| SUNAT diario | cron | 16 | 16 | 100% | 2 min |
| SUNAT diario | manual | 4 | 4 | 100% | 1 min |
| SUNAT descargar XML | cron | 7 | 7 | 100% | 10 min |
| SUNAT descargar XML | manual | 69 | 56 | 81% | 7 min (máx 49) |
| SUNAT extraer rango | manual | 5 | 5 | 100% | 3 min (máx 26) |
| SUNAT padrón de RUC | cron | 10 | 10 | 100% | 8 min |
| SUNAT padrón de RUC | manual | 6 | 6 | 100% | 16 min |
| SUNAT consultar CPE individual | manual | 34 | 28 | 82% | 32 min (máx 103) |

Las fallas se concentran en los días de puesta a punto de cada scraper
(descargar: 17/09 y 22-26/09; individual: 28-29/09). **Todos los cron han
corrido al 100%.**

### 11.2 Consultar CPE individual — éxito por comprobante

| Corridas | Confirmados / intentados | Qué pasó |
|---|---|---|
| #15 (prueba) | 3 / 3 | Primera descarga real |
| #16 | 0 guardados | Cupo de Drive agotado en el 47 de 100; el guardado era todo al final y se perdieron los 46 ya confirmados (se recuperaron después) → se pasó a **guardar cada 20** |
| #17-19 | 248 / 264 (**94%**) | SUNAT estable |
| #20-21 | ~45 / ~200 (~22%) | SUNAT empieza a fallar |
| #22-24 | 9 / 300 (3%) | SUNAT cambió el desplegable de notas → **corregido** el 29/09 |
| #25, #28 | cancelados | Se colgaban con SUNAT caído; el #28 alcanzó a guardar 40 |
| #29-35 (tras el fix) | 137 / 700 (**20%**) | Casi todo lo fallido es SUNAT: «Error del Servidor, reintentar en 5 minutos» |

**Lectura:** con SUNAT estable el script confirma >90%. Desde el 29/09 la
tasa depende de la disponibilidad de SUNAT, no del código. Los que fallan
**no se pierden**: siguen pendientes y se reintentan en la próxima corrida.

### 11.3 Cobertura — qué de lo que existe ya tiene XML y detalle

Comprobantes de compra tipo 01/07/08 (sin la basura "tipo 53" del SIRE):

| Período | E001 en SIRE | E001 con XML | No-E001 en SIRE | No-E001 con XML |
|---|---:|---:|---:|---:|
| 2026-01 | 180 | **0%** | 709 | **0%** |
| 2026-02 | 255 | 100% | 902 | 0% |
| 2026-03 | 448 | 100% | 1 055 | 0% |
| 2026-04 | 299 | 100% | 824 | 0% |
| 2026-05 | 193 | 100% | 546 | 0% |
| 2026-06 | 228 | 100% | 951 | 0% |
| 2026-07 | 909 | 100% | 1 748 | 0% |
| 2026-08 | 1 041 | 100% | 2 106 | 0% |
| 2026-09 | 239 | 97.5% | 824 | **60.1%** |

**Lo que dice la tabla:**
- **E001 está al día** de febrero en adelante. **Enero no se bajó nunca**
  (se puede con «SUNAT extraer rango», 01/01–31/01).
- **No-E001: solo se ha trabajado septiembre.** Enero–agosto suman ~8 800
  comprobantes sin XML. A ~100 por corrida y con la tasa actual, eso son
  semanas de corridas: es una **decisión pendiente** (ver sección 14).

---

## 12. Cómo hacer las tareas comunes

### Bajar no-E001 (lo normal: por la API)
Actions → **SUNAT CPE por API** → Run workflow (vacío = mes anterior + actual),
o en una laptop `pnpm cpe:local` — todo en `docs/pipeline-cpe-local.md`.

### Rehacer la hoja DETALLE sin bajar nada de SUNAT
`npm run hojas:detalle` en la laptop (con `.env.local`). Para cuando cambian sus
columnas o lo que se le cruza (legajo, carpeta madre): `cpe:local` solo
republica si guardó comprobantes nuevos.

### Correr un lote manual de no-E001 por pantallas (respaldo)
Actions → **SUNAT consultar CPE individual** → Run workflow →
`debug` **desmarcado**, `periodo` 202609 (o el que toque), `orden` antiguo,
`limite` 100. Para solo probar: `debug` marcado y `limite` 3.

### Ver cómo salió una corrida
Abrir la corrida → job `consultar` → al final del paso principal:
`Listo: se confirmaron X de Y pendientes procesados (de Z en …)`.
Si algo falló, bajar el artefacto `capturas-cpe-individual`: las capturas
`resultado-*.png` muestran qué respondió SUNAT.

### Verificar en la base (no confiar solo en el log)
En el editor SQL de Supabase:

```sql
-- Cobertura por período y tipo de serie (la tabla 11.3)
with s as (
  select periodo, case when serie ilike 'E%' then 'E' else 'noE' end grupo,
         proveedor_ruc, tipo_comprobante, upper(serie) serie,
         coalesce(nullif(ltrim(numero,'0'),''),'0') numero
  from comprobantes_sunat
  where empresa_ruc='20512201611' and tipo_comprobante in ('01','07','08')
    and proveedor_ruc <> '0'),
c as (
  select proveedor_ruc, tipo_comprobante, upper(serie) serie,
         coalesce(nullif(ltrim(numero,'0'),''),'0') numero
  from cpe_comprobante where empresa_ruc='20512201611')
select s.periodo, s.grupo, count(*) en_sire, count(c.numero) con_xml,
       round(100.0*count(c.numero)/count(*),1) pct
from s left join c using (proveedor_ruc, tipo_comprobante, serie, numero)
group by 1,2 order by 1,2;
```

### Tests y verificaciones locales
```bash
npm ci
npm test                 # tests de lib/ (dominio, ocr, export, sunat, drive, word)
npx tsc --noEmit         # tipos (incluye scripts/)
npm run lint
npm run dev              # la app en local; necesita .env.local
```

### Cambiar el horario de un cron
Editar la línea `cron:` del workflow. Está en **UTC**: Lima es UTC-5 todo el
año (08:00 Lima = `0 13 * * *`). Mantener separados los que usan la cuenta
de SOL (`descargar`, `extraer`, `individual`).

### Agregar una columna a una hoja
1. Migración nueva que agregue el campo a `historico_comprobantes_sunat()` o
   `detalle_cpe()` (la segunda se borra y se crea, porque cambia su tipo).
2. `lib/export/*.ts`: interfaz, cabecera, tipo de columna y valor — **al final**.
3. Actualizar los tests de `lib/export/__tests__/`.

---

## 13. Índice de la documentación existente

| Documento | Tema | Estado |
|---|---|---|
| `docs/proceso-viaticos.md` | El proceso de negocio de viáticos, roles, tipos de memo, decisiones | Vigente |
| **`docs/pipeline-cpe-local.md`** | Pipeline de CPE por la API de SUNAT: cómo funciona, correrlo en local y en Actions, diagnóstico | **Vigente** |
| `docs/cron-sunat.md` | Puesta en marcha de SUNAT diario (robot, secretos) | Vigente |
| `docs/descarga-cpe-y-detalle-de-items.md` | Diseño de la descarga de XML y el detalle de ítems | Vigente (diseño original) |
| `docs/scraper-cpe-hallazgos-tecnicos.md` | Grilla virtual del portal, carreras, botón Imprimir | Vigente |
| `docs/extraer-boletas-y-rangos-largos.md` | Boletas, rangos largos, hoja aparte | Vigente |
| `docs/appscript/README.md` | Instalación de cada Apps Script, tableros, captura de OC | Vigente |
| `docs/rediseno/*` | Handoff del rediseño visual y correcciones | Referencia de diseño |
| `docs/viaticos-as-is-y-to-be.html` | Proceso actual vs. propuesto | Referencia |
| `db/carga/LEEME.md` | Carga del padrón de personas | Histórico |
| `DOSSIER-TECNICO.md` | App versión 1 (antes de Supabase) | **Histórico, desactualizado** |

---

## 14. Pendientes y problemas conocidos

- **Backlog no-E001:** desde el 30/09/2026 se rellena por la API (`scripts/local/`).
  Agosto–septiembre hecho (2 342 de 2 362); marzo–julio en curso; enero–febrero
  pendiente. Estado, pendientes y comandos para continuar:
  **`docs/pipeline-cpe-local.md` §9-10**.
- **E001 de enero:** nunca se bajó; se resuelve con una corrida de «SUNAT
  extraer rango».
- **SUNAT inestable desde el 29/09:** «Error del Servidor, reintentar en 5
  minutos». Era un 500 de la consulta de cabecera: por la API se va directo al
  XML y los 500 que quedan son intermitentes (se reintentan solos).
- **`descargar-cpe.yml` no tiene `concurrency`:** si alguien lo corre a mano a
  la vez que otro workflow que usa la cuenta de SOL, pueden pisarse las
  sesiones.
- **Lectura de logs en vivo:** GitHub no expone el log de un job hasta que
  termina; para saber cuánto lleva una corrida larga, mirar la base
  (`cpe_comprobante` crece cada 20 confirmados).
- Pendientes de la app: pestaña de notas de crédito en la hoja de SUNAT,
  conexión con el MemoTracker, un reembolso real para cerrar el último tipo
  de memo (`docs/proceso-viaticos.md` §8-9).
