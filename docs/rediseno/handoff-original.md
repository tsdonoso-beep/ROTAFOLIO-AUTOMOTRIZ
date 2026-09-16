# Handoff: Rediseño INRO VIÁTICOS (dirección 1a)

## Overview
Rediseño de la UI de **INRO VIÁTICOS** (Next.js + Supabase, repo `tsdonoso-beep/ROTAFOLIO-AUTOMOTRIZ`), enfocado en dos dolores concretos: (1) el flujo móvil del **rendidor** capturando/presentando viáticos, y (2) la bandeja del **administrador de memos**, que hoy es una lista larga sin buscador donde "todo se hace infinito de revisar". Se mantiene el modelo de dominio, los estados y los permisos existentes — solo cambia la interfaz.

## About the Design Files
El archivo `reference.html` de esta carpeta es una **referencia visual estática en HTML**, no código de producción. Muestra look, jerarquía y copy pretendidos con datos de ejemplo. La tarea es **recrear estas pantallas dentro del stack real del proyecto**: Next.js App Router (`app/(app)/…/page.tsx` como server components + client components en `components/v2/`), Tailwind vía `app/globals.css`, Supabase (RLS ya resuelve qué ve cada rol), y los tipos/acciones de servidor ya existentes en `lib/dominio/` y `app/acciones/`. No copiar el HTML tal cual ni introducir un sistema de estilos paralelo.

## Fidelity
**Alta fidelidad de tokens, media-baja de layout final.** Los colores, tipografías, radios y sombras son exactos (tomados literalmente de `app/globals.css` — ver Design Tokens). El layout, copy y densidad de información son intencionados pero abiertos a ajuste fino contra datos reales; no persigas el pixel exacto de `reference.html`, persigue la jerarquía y las reglas de interacción descritas abajo.

## Principios del rediseño
1. **Buscador global siempre visible** — hoy no existe ninguno; es el pedido más repetido. Va arriba en cada shell: móvil dentro de la cabecera, escritorio como campo `⌘K` junto al logo.
2. **Una sola cifra manda por pantalla** — "lo que falta rendir" en móvil, "cuántos memos me frenan a mí" en el admin. Todo lo demás es secundario tipográficamente.
3. **La bandeja del admin deja de ser "infinita"**: se abre siempre en el filtro **"Me frena a mí"** (memos con alertas bloqueantes, observados o sin asignar), no en "todos". Los demás filtros (presentadas, borradores, atrasadas, todas) son pestañas explícitas, nunca el estado inicial.
4. **Selección en lote** en la tabla del admin: aprobar, exportar o recordar a varias personas a la vez — no fila por fila.
5. **Panel de detalle lateral** (no modal, no navegación): clic en una fila abre el expediente a la derecha sin perder la lista. Acciones de aprobar/observar viven ahí.
6. **Captura masiva primero**: la persona dispara varias fotos seguidas antes de que la IA termine de leer cada una; la cola muestra estado por foto (lista / revisar / leyendo) y la fecha del comprobante asigna el memo automáticamente, editable por fila.
7. **Alertas bloqueantes vs. confirmables**: una alerta bloqueante (`severidad: "bloqueante"` en `lib/dominio/tipos.ts`) impide presentar y se resuelve editando el dato; una alerta no bloqueante solo exige el botón "Revisé y confirmo estos datos" (ya existe como patrón en `GastoFila.tsx`, mantenerlo).
8. **CTA primario siempre deshabilitado, nunca oculto**, mientras falte algo — con el texto de qué falta arriba (ver botón "Presentar rendición" en `reference.html`, opacidad 0.4 + `cursor:not-allowed`, patrón ya usado en `VistaMemo.tsx`).

## Screens / Views

### 1. Móvil rendidor · Inicio
- **Purpose**: ver de un vistazo cuánto le queda por rendir y qué le espera (devuelto, observado, offline).
- **Layout**: cabecera fija (avatar + saludo + notificaciones) → barra de búsqueda en píldora → columna de tarjetas con gap 12px → CTA fijo abajo.
- **Componentes**:
  - Avatar circular 34px, iniciales, `background:#00A298`, texto blanco, Sora 700 12px.
  - Buscador: píldora `border-radius:999px`, `background:#F6F8FA`, borde `#E4E9EE`, ícono lupa 17px `#8494A8`, placeholder "Buscar memo, RUC, proveedor…".
  - Aviso de devuelto: franja `background:#FDF3E3` `border:#F0D7A8`, texto `#A15C07` 12px, ícono alerta 15px, chevron a la derecha — es un link a ese memo.
  - Tarjeta de memo activo: cabecera blanca con código mono + badge de estado; zona inferior hundida (`background:#F6F8FA`) con la cifra "Te queda por rendir" en `cifra-xl` (32px/800/Sora, `color:#007A72`), subtítulo con rendido/autorizado, medidor de progreso 8px con color por umbral (ver Design Tokens → Medidor).
  - Tarjeta de memo observado: mismo patrón de card, badge rojo "Observada", texto de siguiente paso.
  - Indicador offline: franja punteada, punto pulsante `#A15C07` (`animation: pulso 1.6s`), texto "Sin señal · N fotos guardadas en el equipo, se suben solas".
  - CTA: botón ancho completo `background:#1D1D1B`, `border-radius:12px`, ícono cámara + "Capturar comprobantes", sombra `0 4px 8px rgba(16,26,38,.06), 0 16px 40px rgba(16,26,38,.12)`.
- **Content/copy** exacto en `reference.html`.

### 2. Móvil rendidor · Captura masiva (cola de captura)
- **Purpose**: disparar varias fotos sin detenerse a llenar formularios; la IA lee y clasifica cada una.
- **Layout**: cabecera con volver + contador "N fotos · M leídas por IA" + badge "IA activa"; fila de 3 stat-cards (Listas / Revisar / Suma); lista de filas por foto; dos CTA al fondo (secundario "Seguir capturando", primario "Guardar N comprobantes").
- **Estados de fila**:
  - **Lista** (verde implícito): thumbnail placeholder rayado + datos leídos + badge del memo asignado.
  - **Con alerta bloqueante** (ej. `COMPROBANTE_AJENO`): franja roja `#FDECEC`, texto de la alerta, dos botones ("Pedir factura nueva" ghost / "Descartar foto" peligro).
  - **En proceso**: thumbnail gris, texto "Leyendo con IA…", barra de progreso indeterminada, "Foto N de M".
- **Behavior**: la asignación de memo es automática por fecha del comprobante (regla ya en `lib/dominio/…` de asignación) pero editable tocando el badge de memo en la fila.

### 3. Móvil rendidor · Presentar
- **Purpose**: último paso antes de enviar la rendición a revisión — visibilizar qué falta y bloquear el envío hasta resolverlo.
- **Layout**: resumen (vas a presentar / devuelves + medidor) → banner de impedimentos si existen → lista de comprobantes, el que tiene alerta primero con su franja lateral izquierda `3px` del color de severidad → CTA final.
- **Regla de bloqueo**: el botón "Presentar rendición · S/ X" está siempre visible pero deshabilitado (opacidad 0.4) mientras `impedimentosParaPresentar()` (ya existe en `lib/dominio/estados.ts`) devuelva algo. El motivo se lista arriba, no solo en el botón.
- **Confirmar alerta no bloqueante**: botón ghost "Revisé y confirmo estos datos" — patrón ya implementado en `GastoFila.tsx`/`VistaMemo.tsx`, mantenerlo tal cual.

### 4. Escritorio · Bandeja del administrador de memos
- **Purpose**: que el admin de memos entre y sepa en 3 segundos qué requiere su acción, sin escanear 62 filas.
- **Layout**: header con logo + buscador global + notificaciones + avatar → tabs de sección (Administrar/Revisar/Contabilidad/Liquidaciones/Caja chica/Sistema, según `lib/dominio/navegacion.ts`) → grid de 2 columnas `minmax(0,1fr) 380px` (lista + panel de detalle).
- **Columna izquierda**:
  - Título + subtítulo con el conteo de "te frenan" + botón primario "Nuevo memo".
  - 4 stat-cards: Necesitan tu acción / En rendición / Con atraso / Sin rendir (S/).
  - Fila de filtros tipo pestañas-píldora, **"Me frena a mí" activo por defecto**, resto son toggles.
  - Barra de acción en lote (aparece solo con selección): fondo `#00A298`, cuenta + suma seleccionada, botones "Abrir memos" y "Recordar al rendidor".
  - Tabla: checkbox · Persona+memo · Estado (badge) · Avance (medidor + conteo) · Rendido (cifra) · Días de atraso. Fila resaltada `background:#E6F5F4` cuando está seleccionada.
- **Columna derecha (panel de detalle)**: se llena al hacer clic en una fila, sin navegar. Muestra rendido/devuelve en grande, banner de alerta si existe, desglose por tipo de gasto (comprobantes formales / movilidad / DJ), estado del cruce SUNAT, y al fondo los botones "Aprobar rendición" (primario oscuro) y "Observar y devolver" (peligro) — coherente con `autoriza()` en `lib/dominio/permisos.ts`: estos botones solo se renderizan si el usuario tiene la acción `aprobar_rendicion`/`observar_devolver`.

## Interactions & Behavior
- **Búsqueda global** (nueva): campo único que busca por nombre de persona, correlativo de memo, RUC de proveedor y serie-número de comprobante. No existe endpoint hoy — requiere una acción de servidor nueva que consulte `memos`, `usuarios`, `gastos` con `ilike`/`textSearch`, respetando el alcance de `permisos.ts` (`ver_memos_ajenos` vs `ver_memos_propios`).
- **Selección en lote**: checkboxes por fila + estado de selección en cliente; las acciones de lote ("Aprobar en lote", "Recordar") llaman las mismas server actions existentes (`app/acciones/memos.ts`) en un `Promise.all`, no una acción nueva por lote.
- **Panel de detalle sin navegación**: usar estado de cliente (`useState` del id seleccionado) + fetch/RSC parcial, no `router.push`. Mantiene la URL en `/administrar`.
- **Filtro "Me frena a mí"**: se computa server-side como memos donde `estado IN ('OBSERVADA')` OR tienen `gastos.alertas` con `severidad='bloqueante'` no confirmadas OR `memo_asignados` vacío. No es un query nuevo de negocio, es una combinación de reglas ya existentes en `lib/dominio/estados.ts` y `lib/dominio/pendientes.ts`.
- **Cola de captura**: la extracción por foto sigue el flujo ya existente de `lib/extraccion/gemini.ts` / `lib/ocr/`; lo nuevo es solo la UI de cola (varias fotos en paralelo con estado individual) en vez de una foto a la vez.
- **Sin señal / offline**: ya existe la idempotencia por `client_id` (`lib/dominio/tipos.ts`); solo falta el indicador visual de "N en cola" en la UI — no es lógica nueva.
- **Estados vacíos**: seguir el componente `Vacio` de `components/v2/Encabezado.tsx` (icono + título + texto + acción) para "no tienes memos", "no hay nada que liquidar", etc.

## State Management
- Selección de filas de tabla (Set de ids) — cliente.
- Id de memo abierto en el panel de detalle — cliente, no en la URL.
- Filtro de pestaña activo en la bandeja del admin — cliente, default `"me-frena"`.
- Cola de captura: array de items `{clientId, foto, estado: 'leyendo'|'lista'|'alerta', resultadoExtraccion, memoAsignado}` — cliente, se sincroniza a Supabase por item conforme cada uno termina (ya es el patrón de `Captura.tsx`).
- Query de búsqueda global — cliente (input) con debounce, resultado vía server action.

## Design Tokens
Tomados literalmente de `app/globals.css` — no inventar valores nuevos.

**Color**
- Fondo app: `--bg #EDF1F4` · superficie: `--surface #FFFFFF` · superficie hundida: `--surface2 #F6F8FA` · pistas de medidor: `--surface3 #EEF2F6`
- Bordes: `--border #E4E9EE` · `--border2 #D2DAE2`
- Marca: `--accent #00A298` (rellenos/bordes/cifras grandes) · `--accent-texto #007A72` (texto pequeño y enlaces, 5.2:1) · `--accent-suave #E6F5F4` · `--accent-borde #A8DED9`
- Texto: `--text #101A24` · `--text2 #52627A` · `--text3 #8494A8`
- Botón primario: `--tinta #1D1D1B` (no es el accent — el primario es casi negro, el accent es secundario/informativo)
- Estados: danger `#C62828`/`#FDECEC`/`#F5C6C6` · warn `#A15C07`/`#FDF3E3`/`#F0D7A8` · success `#0A6E4E`/`#E6F4EE`/`#B4DDCB`

**Tipografía**: Sora (400–800) para display/números/UI con peso, DM Sans (400–600) para texto de cuerpo. Cifras siempre con `font-variant-numeric: tabular-nums` y `letter-spacing:-0.02em` a `-0.035em` según tamaño (clases `.cifra-xl/l/m` ya en globals.css). Código de memo/RUC/serie en `ui-monospace` (clase `.mono`).

**Radios**: `--radio 14px` (tarjetas) · `--radio-s 10px` (inputs, botones) · `--radio-l 18px`.

**Sombras**: `--sombra1` tarjetas en reposo · `--sombra2` hover · `--sombra3` menús/popovers.

**Medidor de consumo** (`.medidor`/`.medidor-relleno`): color por umbral — `--accent` con holgura, `--warn` desde 85% consumido, `--danger` si excede el autorizado. Ya implementado en `components/v2/Encabezado.tsx` (`Medidor`) — reutilizar, no reimplementar.

**Badges de estado** (`.badge` + variantes `-ok/-warn/-error/-neutro/-acento`): punto de color antes del texto, `white-space:nowrap` siempre (definido en la clase `.badge` de `globals.css` — no lo pierdas si conviertes el badge a otro elemento).

**Movimiento**: `--rapido 140ms` / `--medio 220ms`, curva `cubic-bezier(0.2,0.8,0.3,1)`. Entrada escalonada de listas con la clase `.stagger` ya existente.

## Assets
No hay assets de imagen nuevos. Los íconos son el set propio SVG de `components/v2/Iconos.tsx` (stroke 1.75, grid 24, `currentColor`) — usar esos componentes, no un icon pack externo. El logo "rolandprint" es el de `components/Logo.tsx`.

## Modelo de datos y reglas de negocio a respetar (no rediseñar)
- **Roles y permisos**: `lib/dominio/permisos.ts` (`MATRIZ`, `autoriza()`) es la única fuente de verdad de qué botón/sección se muestra a quién. Cualquier acción nueva de UI (recordar en lote, buscador global) debe pasar por esta matriz o extenderla explícitamente, nunca esconder-solo-en-el-cliente.
- **Estados de memo**: `BORRADOR → ABIERTO/EN_RENDICION → PRESENTADA → (OBSERVADA ↺ | APROBADA) → CONTABILIZADA → CERRADO`, más `ANULADO` (`lib/dominio/tipos.ts`, `lib/dominio/estados.ts`).
- **Alertas**: severidad `bloqueante | alta | media | baja` (`lib/dominio/tipos.ts`). Solo `bloqueante` impide presentar; las demás requieren confirmación explícita (`alertas_confirmadas`).
- **Consolidado del memo**: autorizado/rendido/saldo/devolución/reembolso ya calculados por `consolidar()` en `lib/dominio/memo.ts` — no recalcular en el cliente.
- **Navegación por rol**: `lib/dominio/navegacion.ts` (`seccionesDe`, `seccionInicial`) decide qué secciones existen para cada usuario — el shell de escritorio debe seguir generando sus tabs desde ahí, no hardcodearlas.

## Files
- `reference.html` — las 4 pantallas de la dirección elegida (1a): inicio del rendidor, captura masiva, presentar, y bandeja de escritorio del admin de memos. Ábrelo en un navegador — es autocontenido.
- Diseño completo con las otras 2 direcciones exploradas (no elegidas, solo para contexto de por qué se descartaron) vive en el proyecto de diseño original: `Rediseño INRO Viáticos.dc.html` — no es necesario para implementar, referencia solo si hay dudas de dirección.
