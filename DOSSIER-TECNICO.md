# Foto-Grama — Dossier técnico y funcional

**Aplicación de rendición de gastos con extracción automática de comprobantes**

| | |
|---|---|
| **Repositorio** | `tsdonoso-beep/ROTAFOLIO-AUTOMOTRIZ` (rama `main`) |
| **Producción** | `foto-grama.vercel.app` (Vercel, despliegue automático desde `main`) |
| **Estado** | MVP funcional — bloqueado por configuración de una credencial (ver §9) |
| **Tamaño** | 2.590 líneas de TypeScript/TSX en 22 archivos |
| **Fecha del documento** | 4 de septiembre de 2026 |

---

## 1. Problema que resuelve

### 1.1 Situación de partida

La rendición de gastos (caja chica / fondos por rendir) de una operación automotriz se hacía manualmente: alguien juntaba facturas, boletas y tickets en papel o como fotos sueltas en el teléfono, y después transcribía a mano cada dato a una planilla — proveedor, RUC, número de comprobante, fecha, subtotal, IGV, total.

Los puntos de dolor identificados:

1. **Transcripción manual lenta y propensa a error.** Cada comprobante requiere leer y tipear entre 8 y 10 campos.
2. **Las imágenes se pierden o quedan dispersas.** Fotos en el rollo de cámara sin trazabilidad con la fila de la planilla.
3. **No se sabe quién registró qué.** Una planilla compartida sin autoría no permite auditar.
4. **Duplicidad de rendiciones.** Varias personas creando la misma rendición con nombres distintos.
5. **Sin estructura de archivo.** No hay convención de dónde vive el respaldo de cada gasto.

### 1.2 Propuesta

Una aplicación web (móvil y escritorio) donde el usuario:

- Fotografía el comprobante desde el teléfono, o sube el archivo desde escritorio
- Un modelo de visión artificial (Gemini) lee la imagen y extrae los campos estructurados
- La imagen se archiva automáticamente en Google Drive con ruta y nombre convencionales
- El usuario revisa, corrige lo que haga falta, y confirma
- Al confirmar, se agrega una fila a una planilla de Google Sheets, **firmada con su nombre y una marca de tiempo del servidor**, y el registro queda cerrado a edición

El resultado es un expediente con tres piezas enlazadas: **la fila de la planilla**, **la imagen en Drive**, y **la autoría del registro**.

---

## 2. Estado actual — qué funciona y qué no

Verificado ejecutando pruebas reales contra las cuentas de producción, no por inspección de código.

### ✅ Verificado funcionando

| Componente | Evidencia |
|---|---|
| **Google Sheets** | Lectura de la planilla, creación de la hoja `Registro`, escritura de las 25 cabeceras, `append` de una fila y borrado de la fila de prueba. Ejecutado end-to-end contra la planilla real. |
| **Google Drive** | Creación de la ruta anidada `FOTO-GRAMA / <centro de costos> / <caja>` y subida de archivo con generación de `webViewLink`. Ejecutado contra la unidad compartida real. |
| **Compilación** | `next build` limpio, `tsc --noEmit` sin errores. |
| **Despliegue** | Vercel construye y publica automáticamente desde `main`. |

### ⛔ Bloqueado

| Componente | Causa |
|---|---|
| **Extracción con IA (Gemini)** | La API Key configurada no es de Gemini. Las claves de Gemini empiezan con `AIza`; la cargada empieza con `AQ.Ab8`, que corresponde a otro tipo de credencial de Google. Google responde que la clave no da acceso a ningún modelo. **Se resuelve generando una clave en `aistudio.google.com/apikey`** — no requiere cambios de código. |

### ⚠️ Con limitaciones conocidas

Detalladas en §10. Las principales: la identificación de usuario no es autenticación real, no hay base de datos (el estado de trabajo vive en el navegador), y no existe exportación a Excel/CSV.

---

## 3. Arquitectura

### 3.1 Diagrama de flujo

```
┌─────────────────────────────────────────────────────────┐
│  NAVEGADOR (React / Next.js App Router, "use client")   │
│                                                          │
│  • Identificación de usuario (localStorage)              │
│  • Compresión de imagen en <canvas>                      │
│  • Estado de trabajo (localStorage, sin la imagen)       │
│  • API Key de Gemini (localStorage, por usuario)         │
└───────┬──────────────────────┬───────────────┬──────────┘
        │                      │               │
        │ (1) directo          │ (2)           │ (3)
        │ desde el cliente     │               │
        ▼                      ▼               ▼
┌───────────────┐   ┌──────────────────┐  ┌──────────────────┐
│  Gemini API   │   │ /api/drive-upload│  │ /api/sheet-append│
│  (Google AI)  │   │  (servidor)      │  │  (servidor)      │
│               │   │                  │  │                  │
│ Visión + JSON │   │ Service Account  │  │ Service Account  │
└───────────────┘   └────────┬─────────┘  └────────┬─────────┘
                             ▼                     ▼
                    ┌─────────────────┐   ┌─────────────────┐
                    │  Google Drive   │   │  Google Sheets  │
                    │ (unidad         │   │  "REGISTRO"     │
                    │  compartida)    │   │  hoja Registro  │
                    └─────────────────┘   └─────────────────┘
```

**Decisión de diseño relevante:** la llamada a Gemini sale **directamente del navegador** con la clave del usuario, mientras que Drive y Sheets pasan por rutas de servidor con una cuenta de servicio compartida.

- *Ventaja:* el costo de Gemini recae en cada usuario y la clave de servicio nunca toca el cliente.
- *Desventaja:* cada usuario debe configurar su propia clave, y esa clave es visible en el navegador de quien la puso. Ver §10.3 para la alternativa.

### 3.2 Estructura de archivos

```
app/
  layout.tsx                    Fuentes (Sora + DM Sans), metadata, viewport
  page.tsx                      Orquestador principal (455 líneas)
  globals.css                   Sistema de diseño: tokens CSS, utilidades
  api/
    drive-upload/route.ts       POST — sube imagen a Drive
    sheet-append/route.ts       POST — agrega fila a la planilla

components/
  LoginGate.tsx                 Pantalla de identificación
  Logo.tsx                      Logo SVG de Grama, inline
  ApiKeyConfig.tsx              Panel de configuración de la clave Gemini
  ProyectoModal.tsx             Alta de proyecto con detección de duplicados
  ComboCentroCosto.tsx          Buscador desplegable de centros de costos
  UploadZone.tsx                Captura/carga de archivos + compresión
  GastoCard.tsx                 Tarjeta editable por comprobante
  TablaResumen.tsx              Vista tabular consolidada

lib/
  types.ts                      Contratos del dominio
  usuarios.ts                   Catálogo de usuarios y sesión
  centros-costos.ts             Catálogo de centros de costos + normalización
  proyectos.ts                  CRUD de proyectos + deduplicación
  gastos.ts                     Persistencia local de gastos
  gemini.ts                     Cliente de Gemini con descubrimiento de modelo
  prompt.ts                     Prompt de extracción
  drive.ts                      Cliente de la ruta de Drive
  sheet.ts                      Cliente de la ruta de Sheets
  apikey.ts                     Gestión de la clave en localStorage
```

### 3.3 Stack

| Capa | Tecnología | Versión |
|---|---|---|
| Framework | Next.js (App Router, Turbopack) | 16.3.4 |
| UI | React | 19.2.8 |
| Lenguaje | TypeScript | 5.x |
| Estilos | Tailwind CSS 4 + CSS custom properties | 4.x |
| Google APIs | `googleapis` + `google-auth-library` | 178.0.0 / 11.0.2 |
| IA | Gemini API vía REST (`fetch`, sin SDK) | v1beta |
| Hosting | Vercel (funciones serverless para las rutas API) | — |

**No hay base de datos.** No hay ORM, ni Prisma, ni Supabase. La persistencia duradera es la propia planilla de Google Sheets.

---

## 4. Modelo de datos

### 4.1 `GastoItem` — la unidad de trabajo

```typescript
interface GastoItem {
  id: string;                  // base36: timestamp + aleatorio
  proyecto_id: string;         // ← amarra el gasto a un proyecto

  // Archivo
  nombre: string;
  tamanoKB: number;
  base64: string;              // VACÍO tras recargar la página (ver §7)
  mimeType: string;

  // Campos que llena la persona
  numero_solicitud: string;
  fecha_solicitud: string;
  empresa: string;
  responsable: string;
  area_proyecto: string;
  solicitante: string;
  motivo: string;
  estado: "PENDIENTE" | "PAGADO" | "ANULADO";

  // Campos que extrae la IA
  extraido?: GastoExtraido;
  drive_url?: string;
  error_drive?: string;

  // Estado de procesamiento
  procesado: boolean;
  procesando: boolean;
  error?: string;

  // Registro en planilla (append-only)
  registrado?: RegistroInfo;   // ← si existe, el gasto queda cerrado
  registrando?: boolean;
  error_registro?: string;
}
```

### 4.2 `GastoExtraido` — lo que devuelve la IA

```typescript
interface GastoExtraido {
  proveedor: string;
  detalle: string;                    // máx. 120 caracteres
  monto_total: number;
  tipo_comprobante: "FACTURA" | "BOLETA" | "RECIBO"
                  | "TICKET" | "NOTA_CREDITO" | "OTRO";
  numero_comprobante: string;         // ej. "F001-00001234"
  fecha_comprobante: string;          // ISO YYYY-MM-DD
  forma_pago: string;                 // EFECTIVO | TARJETA | TRANSFERENCIA | ...
  moneda: "PEN" | "USD";
  subtotal?: number;
  igv?: number;
}
```

### 4.3 `Proyecto` — la unidad de agrupación

```typescript
interface Proyecto {
  id: string;
  nombre: string;          // se autogenera: "<centro> — <caja>"
  centro_costos: string;   // debe coincidir con la carpeta de Drive
  caja: string;
  creado: string;          // ISO
}
```

**Clave de identidad:** un proyecto se identifica por `centro_costos + caja` normalizados (minúsculas, sin tildes, espacios colapsados). No por su `id` ni por su nombre. Esto es lo que hace posible la deduplicación (§6.2).

### 4.4 `RegistroInfo` — el sello de autoría

```typescript
interface RegistroInfo {
  usuario_id: string;
  usuario_nombre: string;
  fecha: string;   // ISO — generada EN EL SERVIDOR, no en el navegador
}
```

---

## 5. Flujo funcional completo

### Paso 1 — Identificación

Al abrir la app aparece una pantalla que bloquea el acceso. El usuario elige su nombre de una lista y escribe una clave numérica.

**Catálogo actual** (`lib/usuarios.ts`):

| ID | Nombre | Iniciales |
|---|---|---|
| `tdonoso` | Tomás Donoso | TD |
| `cgarciarosell` | Camila García Rosell | CG |

Clave compartida: `2306` para ambos.

> **Advertencia explícita:** esto **no es autenticación**. La clave está en el código JavaScript que se descarga al navegador y cualquiera puede leerla abriendo las herramientas de desarrollo. Su función es **atribución** — saber quién registró cada gasto — no control de acceso. Está documentado como tal en el propio código fuente. Ver §10.1.

La sesión se guarda en `localStorage` y persiste entre recargas hasta pulsar "Salir".

### Paso 2 — Selección o creación de proyecto

Un proyecto representa una rendición: una combinación de centro de costos y caja/memo.

El formulario pide **dos campos**:

1. **Centro de costos** — buscador desplegable con filtrado tolerante (ignora mayúsculas y tildes), que también admite texto libre
2. **N° Caja / Memo** — texto libre

El **nombre del proyecto se genera solo** como `"<centro de costos> — <caja>"`. Queda editable pero no es obligatorio.

Si ya existe un proyecto con esa combinación, el formulario lo advierte antes de confirmar y el botón cambia a *"Usar proyecto existente"*.

### Paso 3 — Carga de comprobantes

**En móvil:** dos botones grandes — *Tomar foto* (abre la cámara trasera vía `capture="environment"`) y *Galería*.

**En escritorio:** zona de arrastrar y soltar, más botones de selección de archivo y cámara.

Acepta imágenes y PDF. Cada archivo cargado se amarra al proyecto activo mediante `proyecto_id`.

**Compresión automática** (`UploadZone.tsx`): las imágenes se redimensionan a un máximo de 1800 px por lado y se recomprimen a JPEG calidad 82% usando un `<canvas>` en el navegador.

- *Motivo:* una foto de teléfono pesa entre 4 y 6 MB; codificada en base64 crece un 33% más. Eso hacía que Gemini la rechazara o tardara mucho.
- *Resultado medido:* una foto de 4.887 KB baja a ~300 KB sin perder legibilidad del comprobante.
- Los PDF no se tocan. Las imágenes ya pequeñas (< 900 KB y bajo el límite de tamaño) tampoco.
- Los PNG con transparencia se componen sobre fondo blanco antes de convertir a JPEG, para que no salgan negros.

### Paso 4 — Extracción con IA

El usuario pulsa **IA ✦** en una tarjeta, o **Extraer todos (N)** para procesar en lote de forma secuencial.

**Descubrimiento de modelo** (`lib/gemini.ts`): en vez de codificar un modelo fijo, la app consulta a Google qué modelos admite esa clave y filtra los que soportan `generateContent`. Elige según orden de preferencia:

```
gemini-2.5-flash  →  gemini-2.5-flash-lite  →  gemini-2.0-flash  →  gemini-flash-latest
```

Si ninguno de la lista está disponible, cae a cualquier modelo Gemini con visión. El modelo elegido queda en caché por clave, y se descarta si deja de responder con 404.

> **Contexto de esta decisión:** originalmente el código tenía fijo `gemini-2.5-flash-lite-preview-06-17`, un modelo *preview* de junio de 2025. Google retira los preview a los pocos meses, y para septiembre de 2026 devolvía 404 en cada llamada. El descubrimiento dinámico evita que la app vuelva a romperse cuando Google rote versiones.

**Parámetros de generación:**

```javascript
{
  temperature: 0.1,                        // determinismo para extracción
  maxOutputTokens: 2048,
  responseMimeType: "application/json",    // fuerza JSON sin markdown
  thinkingConfig: { thinkingBudget: 0 }    // desactiva razonamiento interno
}
```

> `thinkingBudget: 0` es relevante: los modelos Gemini 2.5 razonan internamente antes de responder, y ese razonamiento consume del presupuesto de tokens. Con el límite original de 512 el modelo agotaba el presupuesto pensando y devolvía **texto vacío**, produciendo un error engañoso de "JSON inválido".

**Prompt** (`lib/prompt.ts`): pide extraer a un esquema JSON fijo, contemplando comprobantes peruanos (facturas electrónicas con RUC y hash, boletas manuales o electrónicas, recibos manuscritos, tickets de caja, notas de crédito, proformas). Instruye asumir soles salvo indicación de USD, y devolver `""` o `0` en vez de inventar datos cuando no puede leer un campo.

**Archivo en Drive:** inmediatamente después de una extracción exitosa, la imagen sube a Drive. La ruta se construye desde el proyecto activo:

```
FOTO-GRAMA / <centro de costos> / <caja> / <fecha>_<proveedor>_<nº comprobante>.jpg
```

Ejemplo real:
```
FOTO-GRAMA / 1.3 Instalación / CAJA-2026-03 / 2026-03-23_FOR_ELECTRIC_FE01-00002591.jpg
```

Las carpetas se crean si no existen. El enlace resultante (`webViewLink`) se guarda en el gasto y termina en la columna *Enlace Drive* del registro.

Si Drive falla, la extracción **no se pierde** — el gasto queda procesado pero la tarjeta muestra una advertencia indicando que la fila del registro quedará sin enlace.

### Paso 5 — Revisión y corrección

La tarjeta muestra:

- **Datos extraídos por la IA** (solo lectura, en color de acento) — proveedor, tipo, número, fecha, forma de pago, total, detalle
- **Campos manuales editables** — N° solicitud, fecha solicitud, empresa, responsable, área/proyecto, solicitante, motivo, estado

`empresa` se prellena con el proveedor detectado y `motivo` con el detalle, solo si estaban vacíos.

### Paso 6 — Registro en planilla

Al pulsar **Registrar** (individual) o **Registrar N en planilla** (lote, con confirmación explícita porque no se puede deshacer):

1. Se envía la fila a `/api/sheet-append`
2. El servidor genera la marca de tiempo — **no el navegador**, para que no se pueda falsear cambiando el reloj del equipo
3. Se agrega la fila a la hoja `Registro`
4. La tarjeta queda **cerrada**: todos los campos pasan a solo lectura y aparece el sello

```
🔒 Registrado por Camila García Rosell · 04 sep, 18:32
```

Si se intenta eliminar una tarjeta ya registrada, se advierte que quitarla de la pantalla **no borra** la fila de la planilla.

---

## 6. Reglas de negocio implementadas

### 6.1 Separación de proyectos

Cada `GastoItem` lleva `proyecto_id`. La pantalla filtra por el proyecto activo, de modo que las rendiciones no se mezclan visualmente ni en los totales. El selector muestra el conteo de comprobantes por proyecto.

### 6.2 Deduplicación de proyectos

```typescript
function claveProyecto(centro: string, caja: string): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return `${norm(centro)}||${norm(caja)}`;
}
```

`saveProyecto()` busca un duplicado por esa clave antes de crear. Si lo encuentra, **devuelve el existente** en vez de crear uno nuevo. Así `"TALLER-01 / caja 03"` y `"taller-01 / CAJA 03"` se reconocen como el mismo proyecto y las rendiciones se acumulan.

### 6.3 Inmutabilidad del registro

La planilla es **append-only** desde la aplicación: solo se agregan filas, nunca se modifican ni borran las existentes. Una vez registrado, el gasto queda bloqueado en la interfaz. Las correcciones se hacen editando la hoja de cálculo directamente, lo que deja rastro en el historial de versiones de Google Sheets.

### 6.4 Catálogo de centros de costos

`lib/centros-costos.ts` — el buscador filtra con normalización Unicode (`NFD` + eliminación del rango `̀-ͯ`), por lo que *"adecuacion"* encuentra *"1.2 Adecuación"*.

**Catálogo actual (provisional):**

```
1.1 Transporte y entrega de bienes
1.2 Adecuación
1.3 Instalación
1.4 Capacitación
```

> Esta lista **no es oficial**: se extrajo inspeccionando las carpetas existentes en la unidad compartida de Drive. Está pendiente reemplazarla por el catálogo real.

**Restricción importante:** los nombres deben coincidir **exactamente** con las carpetas de Drive, porque la app construye la ruta con ese texto literal. Un nombre distinto genera una carpeta nueva en lugar de usar la existente. El campo admite texto libre pero advierte cuando el valor no está en el catálogo.

---

## 7. Persistencia

| Dato | Dónde vive | Sobrevive recarga | Compartido entre usuarios |
|---|---|---|---|
| Sesión de usuario | `localStorage` | Sí | No |
| API Key de Gemini | `localStorage` | Sí | No |
| Proyectos | `localStorage` | Sí | **No** |
| Gastos (metadatos) | `localStorage` | Sí | **No** |
| Imagen (`base64`) | Memoria RAM | **No** | No |
| **Fila del registro** | **Google Sheets** | **Sí** | **Sí** |
| **Imagen archivada** | **Google Drive** | **Sí** | **Sí** |

### Por qué la imagen no se guarda localmente

`localStorage` tiene un límite de aproximadamente 5 MB por sitio. Cada imagen comprimida en base64 ocupa entre 200 y 500 KB, así que una decena de comprobantes agotaría la cuota y rompería la sesión completa.

**Consecuencia práctica:** al recargar la página los datos y el enlace de Drive se conservan, pero **no se puede reprocesar con IA** un comprobante cargado antes de la recarga. La tarjeta lo indica explícitamente y pide volver a subir el archivo. La escritura a `localStorage` está envuelta en `try/catch`: si la cuota se llena, la app sigue funcionando en memoria en vez de romperse.

### Implicación de arquitectura

**Los proyectos y los gastos en curso son locales a cada navegador.** Si Tomás crea un proyecto, Camila no lo ve en su equipo — tendría que crearlo con la misma combinación de centro y caja. Lo único verdaderamente compartido es lo ya registrado en la planilla y las imágenes en Drive. Ver §10.2.

---

## 8. Integraciones — detalle técnico

### 8.1 Google Drive

**Ruta:** `POST /api/drive-upload`

```typescript
// Petición
{ base64, mimeType, fileName, carpeta1, carpeta2 }
// Respuesta
{ id, url }
```

**Autenticación:** cuenta de servicio `repo-print-drive@ardent-bulwark-489403-v6.iam.gserviceaccount.com`, alcance `https://www.googleapis.com/auth/drive`.

**Detalle crítico — unidades compartidas:**

```typescript
const DRIVES = { supportsAllDrives: true, includeItemsFromAllDrives: true };
```

La carpeta `FOTO-GRAMA` vive en una unidad compartida (`driveId: 0AP1lZyx7g-kNUk9PVA`). **La API de Drive ignora las unidades compartidas por completo salvo que se pasen estos parámetros en cada llamada.** Sin ellos responde `File not found` aunque la carpeta exista y los permisos estén correctos.

Este fue un fallo real en producción: durante todo el desarrollo inicial **ninguna imagen llegó nunca a Drive**, y como los errores de Drive estaban silenciados con un `catch` vacío, nadie se enteraba.

**Permisos de los archivos:** los archivos subidos **heredan los permisos de la unidad compartida**. Anteriormente se les aplicaba `{ role: "reader", type: "anyone" }`, lo que hacía cada factura visible para cualquiera con el enlace. Se eliminó por considerarse inadecuado para comprobantes internos.

**Limitación observada:** la cuenta de servicio tiene rol de Colaborador en la unidad compartida — puede crear pero **no eliminar** archivos ni carpetas. La aplicación nunca elimina, así que no la afecta.

### 8.2 Google Sheets

**Ruta:** `POST /api/sheet-append`

**Planilla:** `1FODJP-Zn3aAEcZXIRICxcMIpnzUpzUbDDv_TqXrVmrI` — documento "REGISTRO", ubicado dentro de la carpeta FOTO-GRAMA en la unidad compartida.

**Hoja:** `Registro`. Se crea automáticamente con sus cabeceras la primera vez, si no existe.

**Esquema — 25 columnas (A:Y):**

| # | Columna | Origen |
|---|---|---|
| A | ID Gasto | Aplicación |
| B | Fecha Registro | **Servidor** |
| C | Registrado Por | Sesión de usuario |
| D | Proyecto | Proyecto activo |
| E | Centro de Costos | Proyecto activo |
| F | Caja / Memo | Proyecto activo |
| G | N° Solicitud | Manual |
| H | Fecha Solicitud | Manual |
| I | Proveedor | **IA** |
| J | Tipo Comprobante | **IA** |
| K | N° Comprobante | **IA** |
| L | Fecha Comprobante | **IA** |
| M | Moneda | **IA** |
| N | Subtotal | **IA** |
| O | IGV | **IA** |
| P | Total | **IA** |
| Q | Forma de Pago | **IA** |
| R | Detalle | **IA** |
| S | Empresa | Manual (prellenado con proveedor) |
| T | Responsable | Manual |
| U | Área / Proyecto | Manual |
| V | Solicitante | Manual |
| W | Motivo | Manual (prellenado con detalle) |
| X | Estado | Manual |
| Y | Enlace Drive | Drive |

**Método:** `spreadsheets.values.append` con `insertDataOption: "INSERT_ROWS"` y `valueInputOption: "USER_ENTERED"` (para que Sheets interprete números y fechas con su formato local).

### 8.3 Gemini

**Llamada:** directa desde el navegador a `generativelanguage.googleapis.com/v1beta`.

**Autenticación:** API Key personal de cada usuario, guardada en su `localStorage`.

**Manejo de errores traducido a lenguaje accionable:**

| Condición | Mensaje al usuario |
|---|---|
| `API_KEY_INVALID` | "La API Key no es válida para Gemini. Debe empezar con «AIza»…" |
| `SERVICE_DISABLED` | "La API de Gemini no está habilitada en el proyecto de Google Cloud…" |
| HTTP 401 / 403 | "La API Key no tiene permiso para usar Gemini…" |
| HTTP 429 | "Se superó el límite de solicitudes. Espera un minuto…" |
| HTTP ≥ 500 | "Google tuvo un problema temporal…" |
| `finishReason: SAFETY` | "Gemini bloqueó esta imagen por sus filtros de contenido." |
| `finishReason: MAX_TOKENS` | "La respuesta se cortó por longitud…" |
| Respuesta vacía | "Gemini devolvió una respuesta vacía. Intenta de nuevo." |

---

## 9. Configuración

### Variables de entorno (Vercel, ámbito Production)

| Variable | Contenido |
|---|---|
| `GOOGLE_SA_EMAIL` | Correo de la cuenta de servicio |
| `GOOGLE_SA_PRIVATE_KEY` | Clave privada PEM (con `\n` escapados) |
| `GOOGLE_DRIVE_FOLDER_ID` | `16ltlH3J74zE2ufYyCqZBO-kNh6hXAbhB` (carpeta FOTO-GRAMA) |
| `GOOGLE_SHEET_ID` | `1FODJP-Zn3aAEcZXIRICxcMIpnzUpzUbDDv_TqXrVmrI` |

Ninguna lleva prefijo `NEXT_PUBLIC_`, por lo que solo son accesibles desde el servidor. `.gitignore` excluye `.env*`; las credenciales nunca se han versionado.

### APIs de Google Cloud requeridas

Proyecto `587507391134`:

- ✅ **Google Drive API** — habilitada
- ✅ **Google Sheets API** — habilitada (fue necesario activarla explícitamente; se habilita por separado de Drive y ese fue un bloqueo real durante la integración)

### Permisos

- La cuenta de servicio tiene acceso de edición a la unidad compartida que contiene `FOTO-GRAMA` y la planilla `REGISTRO`

### Pendiente

- ⛔ **API Key de Gemini válida** (formato `AIza…`), a generar en `aistudio.google.com/apikey` y cargar desde el botón 🔑 de la aplicación

---

## 10. Limitaciones conocidas y deuda técnica

Se listan de forma explícita para que puedan ser evaluadas.

### 10.1 La identificación de usuario no es seguridad

El PIN `2306` está en el bundle de JavaScript del cliente. Cualquiera puede leerlo con las herramientas de desarrollo, y cualquiera con la URL puede entrar eligiendo el nombre de otra persona. **La atribución de autoría es declarativa, no verificable.**

Fue una decisión consciente y acordada para el MVP. Para que la autoría sea confiable haría falta mover la verificación al servidor con sesiones firmadas, o integrar un proveedor de identidad (Google Workspace sería natural dado que el resto del stack ya es Google).

### 10.2 No hay estado compartido entre usuarios

Proyectos y gastos en curso viven en el `localStorage` de cada navegador. Dos personas trabajando la misma rendición no ven el trabajo de la otra hasta que se registra en la planilla. Tampoco se puede retomar en otro dispositivo lo empezado en el teléfono.

Resolverlo requiere una base de datos. Se evaluó Supabase en su momento y no se implementó.

### 10.3 La API Key de Gemini es individual y vive en el cliente

Cada usuario debe generar y configurar la suya, lo que es fricción de incorporación. Además queda expuesta en su navegador.

*Alternativa:* mover la llamada a Gemini a una ruta de servidor con una clave única de la organización. Centraliza el costo y oculta la credencial, a cambio de que el tráfico de imágenes pase por el servidor.

### 10.4 No hay exportación

No se puede descargar la rendición como Excel o CSV desde la aplicación. La planilla de Google cumple parcialmente esa función, pero no hay un consolidado por proyecto listo para adjuntar a un expediente.

### 10.5 Condición de carrera al crear carpetas en Drive

Si dos usuarios procesan simultáneamente comprobantes del mismo centro de costos, ambos pueden encontrar la carpeta inexistente y crearla, quedando dos carpetas con el mismo nombre. Drive lo permite.

Probabilidad baja con dos usuarios; el impacto es cosmético (archivos repartidos en dos carpetas homónimas).

### 10.6 Sin pruebas automatizadas

No hay tests unitarios ni de integración. La verificación ha sido manual mediante scripts ejecutados contra las cuentas reales.

### 10.7 El catálogo de centros de costos es provisional

Se dedujo de las carpetas de Drive, no de una fuente oficial. Ver §6.4.

### 10.8 Procesamiento secuencial

"Extraer todos" procesa un comprobante a la vez. Con 20 comprobantes y ~3 segundos cada uno, son unos 60 segundos de espera. Podría paralelizarse con un límite de concurrencia, cuidando los límites de cuota de Gemini.

### 10.9 Sin reintento automático

Un fallo transitorio de red obliga a pulsar "Reintentar" manualmente. No hay reintentos con espera exponencial.

### 10.10 No se valida la coherencia aritmética

No se comprueba que `subtotal + IGV = total`, ni que el IGV sea el 18% que corresponde en Perú. Un error de lectura de la IA en un dígito pasa sin señal de alerta.

---

## 11. Historial de decisiones relevantes

| Decisión | Motivo |
|---|---|
| Vercel en vez de GitHub Pages | La app necesita rutas de servidor para proteger las credenciales de la cuenta de servicio; GitHub Pages solo sirve archivos estáticos |
| Sin base de datos | Alcance de MVP; la planilla de Google actúa como almacén duradero y ya es el formato que el equipo consume |
| Gemini desde el cliente | Evita exponer una clave compartida y distribuye el costo por usuario |
| Descubrimiento dinámico de modelo | Un modelo *preview* fijo quedó obsoleto y rompió la app; ahora se consulta qué hay disponible |
| Compresión en el navegador | Las fotos de teléfono superaban los límites prácticos de la API de visión |
| Planilla append-only | Requisito de trazabilidad: el registro debe ser auditable, no editable desde la app |
| Marca de tiempo del servidor | Evita que se pueda falsear cambiando el reloj del equipo |
| Sin permiso público en Drive | Los comprobantes son documentos internos; heredar los permisos de la unidad compartida es lo correcto |
| Nombre de proyecto autogenerado | Centro de costos + caja ya identifican la rendición; pedir un nombre aparte era redundante y fuente de duplicados |

---

## 12. Puntos abiertos para discusión

Cuestiones donde una segunda opinión aportaría, ordenadas por impacto estimado:

1. **¿La atribución declarativa es suficiente para el uso previsto?** Si la rendición tiene valor contable o de auditoría, probablemente no, y conviene priorizar autenticación real.

2. **¿Se necesita estado compartido entre usuarios?** Determina si hace falta una base de datos o si el modelo actual (cada quien trabaja su tanda y la planilla consolida) es adecuado al flujo real.

3. **¿El esquema de 25 columnas cubre lo que el expediente exige?** Puede faltar RUC del proveedor, centro de costos codificado, número de orden de compra, o campos de aprobación.

4. **¿Debe existir un flujo de aprobación?** Hoy registrar es un acto único. No hay estado "pendiente de aprobación" ni segundo firmante.

5. **¿La estructura de carpetas en Drive es la correcta?** Actualmente `centro de costos / caja`. Podría convenir incluir el año o el mes.

6. **¿Qué hacer con comprobantes anulados o rechazados?** El campo `estado` los contempla, pero se registran en la misma hoja sin tratamiento diferenciado. (Se observó una factura con sello "RECHAZADO" entre los casos de prueba.)

7. **¿Hace falta validación aritmética y de RUC?** Un dígito mal leído por la IA hoy pasa desapercibido.

8. **¿Conviene centralizar la clave de Gemini?** Compensa fricción de incorporación contra exposición de credencial y control de costos.

---

## 13. Cómo reproducir el entorno

```bash
git clone https://github.com/tsdonoso-beep/ROTAFOLIO-AUTOMOTRIZ
cd ROTAFOLIO-AUTOMOTRIZ
npm install

# Crear .env.local con las cuatro variables de §9
npm run dev          # desarrollo en localhost:3000
npm run build        # verificación de compilación
npx tsc --noEmit     # verificación de tipos
```

---

*Documento generado a partir de la inspección directa del código en el commit `95fdccf` y de pruebas ejecutadas contra las cuentas de Google de producción.*
