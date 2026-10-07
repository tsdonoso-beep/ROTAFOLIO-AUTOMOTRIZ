# Estado y pendientes — 07/10/2026

Memoria de trabajo para retomar sin releer toda la conversación. Lo de cómo
funciona cada pieza está en `GUIA-DEL-REPOSITORIO.md` y `docs/appscript/README.md`.

## Dónde vive todo (desde el 07/10/2026)

- **Libro único INROCONTA**: `1n_MZD30CQ1b3HZlVCstQZ3giGaE-sKsB5_U3dobtdpE`
  (en la unidad del usuario, compartido como Editor con la cuenta de servicio
  `repo-print-drive@ardent-bulwark-489403-v6.iam.gserviceaccount.com`).
  - Pestañas del robot: COMPROBANTES SUNAT, COMPROBANTES SUNAT - DETALLE (y «… 2025»),
    OC - CARPETAS COMPRAS NACIONALES / IMPORTACIONES. `lib/drive/servidor.ts` → `LIBRO_ID`.
  - Pestañas de Apps Script: CARPETA MADRE, CARPETA MADRE - RESUMEN, FACTURAS SIN OC
    (`CarpetaMadre.gs`), PADRÓN RUC (`PadronRuc.gs`).
- **Vista INROCONTA** (Apps Script del libro, `VistaEjecutiva.gs` + `VistaEjecutivaPagina.html`):
  https://script.google.com/a/macros/inroprin.com/s/AKfycbzwyVcFPhZqhp5bXjo2TWA9JjibhzGJeKE1mC33m0zQKM637f0many_4VsLghUXyLb-/exec
  Se actualiza con «Nueva versión» en la misma implementación (el enlace no cambia).
- **Hojas viejas** (solo consulta, el robot TODAVÍA publica también ahí):
  DETALLE `1Kp5RS…`, COMPROBANTES SUNAT `1ttW7D…`, GENERAL `1tWakeoj…`.
- **Hoja privada de fuentes** `1sJhaKxamPG1lIEAaso5uprqUU_ixHLylQtAY53KUEms`: queda aparte (sensible).
- **Base**: Supabase `vqabgnynidehfqueupki`. Migraciones hasta la **065**.
- **Guía para Gabo** (Claude Docs): https://claude.ai/code/artifact/3540ccae-f2c2-43b3-bc41-e0d259a7f503

## Hecho en la reunión del 06/10/2026 (y después)

- 061 Filtro por empresa en el legajo (INROPRIN por defecto; 33 carpetas de consorcios) y «Pago de OC» en nacionales.
- 062 Domicilio fiscal (padrón reducido, robot `padron-domicilios.yml` los lunes; `npm run domicilios:local`):
  3,008 RUC cargados, 2,095 con dirección (todas las empresas). Ficha del proveedor en «Buscar factura».
- 063 Cuadre de ventas e IGV por mes (Impuestos). Hallazgos: facturas con anticipo traen IGV neto
  (29 en cero en 2026); NC de abril por S/ 8 M (IGV S/ 1.22 M); enero sin ventas en los XML.
- 064 `VerificarComprobantes.gs` (verificar una carga contra SUNAT antes del CONCAR) — **en pausa por decisión del usuario**.
- Libro único INROCONTA + vista renombrada INROCONTA.

## Pendientes

**Mudanza**
- [ ] Tras 1–2 días con INROCONTA al día: apagar la publicación en las hojas viejas
      (`HOJAS_SUELTAS=0` en los workflows, o cambiar el valor por omisión en `servidor.ts`)
      y quitar `hojaFija` de DETALLE.
- [ ] Confirmar que se quitaron los activadores viejos (GENERAL: «Dejar de traerla sola»; vista vieja: `prepararVista`).
- [ ] Borrar la pestaña vacía «Hoja 1» de INROCONTA.
- [ ] Opcional: la vista lee hoy el DETALLE de la hoja (27k filas); pasarla a leer de la base sería más rápido.

**Decisiones del usuario sin responder**
- [ ] ¿Sacar las facturas del BCP (20100047218) de los reintentos de la API (siempre error 500) y marcarlas «pedir al banco»?
- [ ] ¿Barrido semanal automático de todo el SIRE del año (no solo mes actual y anterior)?
- [x] Robot de buen contribuyente ampliado a clientes, Base de Compras y RUC con domicilio (migración 065): 180 pendientes, ~2 días.
- [x] Domicilio en la pestaña PADRÓN RUC (y la pestaña ya trae todos los RUC, no solo 1000).

**Siguiente trabajo pedido**
- [ ] **Detracciones**: extraer las constancias de depósito del menú SPOT de SUNAT SOL. El usuario va a mandar
      pantallazos del recorrido (menú → filtros → resultado → descarga → constancia). Analizar cada uno antes de
      programar. Reusar el login de `scripts/local/sol/sesion.mts`. Preguntar si el objetivo es el PDF junto a la
      factura (legajo) o la tabla de cruce factura ↔ depósito.
- [ ] Rendiciones en «Buscar factura».
- [ ] CONCAR (carga masiva de setiembre con la tabla de Rosa): retomar cuando el usuario lo indique; necesita los
      títulos de columnas de la tabla y el registro del CONCAR (enero a la fecha).
- [ ] IGV declarado de un mes (PDT 621) para cerrar el cuadre de ventas.

**En pausa / no tocar**
- Alertas a compradores (hasta que todos estén conformes).
- Memos (esperar a Franco). INROPLAS después de INROPRIN. Consorcios: información reservada.

## Avisos técnicos

- Supabase: `statement_timeout` 8 s para authenticated; PostgREST entrega máx. 1000 filas (paginar con `.range`).
- MCP de Supabase se cuelga con DROP o DELETE sin WHERE.
- El usuario corre los workflows (la sesión no puede dispararlos: 403). Hay un Claude local en su PC (Windows/PowerShell)
  con `.env.local`; para cargas grandes darle instrucciones listas para pegar.
- La vista guarda copia en caché (CacheService); si muestra datos viejos: `prepararVista` desde el editor.
- El usuario es principiante: responder en español, paso a paso.
