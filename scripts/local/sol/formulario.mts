// «Nueva Consulta de comprobantes de pago»: llenar, consultar, leer el resultado, bajar, cerrar.

import type { Frame, Page, Download } from "playwright";
import { clasificarTexto, type Clase, type Pendiente } from "../comun/tipos.mts";
import { tipoPorNombre, type Archivo } from "../comun/drive.mts";

function etiquetaTipo(tipo: string): string {
  return ({ "01": "Factura", "07": "Nota de Crédito", "08": "Nota de Débito" } as Record<string, string>)[tipo] ?? "Factura";
}
/** Notas: desde el 29/09/2026 el desplegable junta la nota con lo que modifica («Factura - Nota de Crédito»). */
function calificadorTipo(p: Pendiente): string | undefined {
  if (p.tipoComprobante !== "07" && p.tipoComprobante !== "08") return undefined;
  return /^B/i.test(p.serie) ? "Boleta de Venta" : "Factura";
}

/** Elige el tipo en el combobox (PrimeNG). Devuelve el texto de la opción elegida, para reusarlo la próxima vez. */
export async function elegirTipo(marco: Frame, p: Pendiente, actual: string | null): Promise<string> {
  const etiqueta = etiquetaTipo(p.tipoComprobante);
  const calificador = calificadorTipo(p);
  const quiere = (t: string) => t.includes(etiqueta) && (!calificador || t.includes(calificador));
  const vacio = marco.getByText("Seleccionar", { exact: true }).first();
  const estaVacio = await vacio.isVisible().catch(() => false);
  if (actual && quiere(actual) && !estaVacio) return actual;
  const campo = estaVacio || !actual ? vacio : marco.getByText(actual, { exact: true }).first();
  if (!(await campo.count())) throw new Error("no encontré el combobox de «Tipo de comprobante»");
  await campo.click({ timeout: 5000 });
  await marco.page().waitForTimeout(400);
  const c = marco.locator(`li:has-text("${etiqueta}"), [role="option"]:has-text("${etiqueta}"), .p-dropdown-item:has-text("${etiqueta}")`);
  const n = await c.count();
  for (let i = 0; i < n; i++) {
    const t = ((await c.nth(i).textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
    if (quiere(t) && await c.nth(i).isVisible().catch(() => false)) { await c.nth(i).click({ timeout: 5000 }); return t; }
  }
  throw new Error(`el combobox no ofreció «${calificador ? calificador + " - " : ""}${etiqueta}» (${n} candidatos)`);
}

export async function llenar(marco: Frame, p: Pendiente, tipoActual: string | null): Promise<string> {
  const radio = marco.locator("#recibido").first();
  if (await radio.count()) await radio.check({ timeout: 3000 }).catch(() => radio.click({ force: true, timeout: 3000 }).catch(() => {}));
  const tipo = await elegirTipo(marco, p, tipoActual);
  await marco.locator('input[name="rucEmisor"]').first().fill(p.proveedorRuc, { timeout: 5000 });
  await marco.locator('input[name="serieComprobante"]').first().fill(p.serie, { timeout: 5000 });
  await marco.locator('input[name="numeroComprobante"]').first().fill(p.numero, { timeout: 5000 });
  return tipo;
}

export async function clicConsultar(marco: Frame): Promise<void> {
  for (const loc of [marco.locator('input[value="Consultar"], input[value="Buscar"]'), marco.getByRole("button", { name: /consultar|buscar/i })]) {
    if (await loc.first().count()) { await loc.first().click({ timeout: 10000 }); return; }
  }
  throw new Error("no encontré el botón Consultar/Buscar");
}

// Donde una app Angular/Bootstrap/PrimeNG pinta un error o un aviso.
const MENSAJES = "[role=alert], [role=alertdialog], .alert, .toast, .p-toast-message, .invalid-feedback, .text-danger, ngb-alert, .modal-body, .modal-title";

export async function textosVisibles(marco: Frame): Promise<string[]> {
  return marco.locator(MENSAJES).evaluateAll(els => {
    const out: string[] = [];
    for (const e of els) {
      const el = e as HTMLElement;
      const r = el.getBoundingClientRect();
      const t = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (r.width && r.height && t && t.length < 600 && !out.includes(t)) out.push(t);
    }
    return out.slice(0, 12);
  }).catch(() => [] as string[]);
}

const BOTON_XML = 'button[ngbtooltip="Descargar XML"]';
const BOTON_PDF = 'button[ngbtooltip="Descargar PDF"]';

/** Espera activa hasta: botón de XML (OK), un mensaje reconocible de SUNAT, o el tope. */
export async function esperarResultado(marco: Frame, topeMs: number, extras: () => string[]): Promise<{ clase: Clase; textos: string[] }> {
  const fin = Date.now() + topeMs;
  let textos: string[] = [];
  while (Date.now() < fin) {
    if (await marco.locator(BOTON_XML).first().isVisible().catch(() => false)) return { clase: "OK", textos: [] };
    textos = [...await textosVisibles(marco), ...extras()];
    const c = clasificarTexto(textos);
    if (c) return { clase: c, textos };
    await marco.page().waitForTimeout(300);
  }
  const cuerpo = await marco.locator("body").innerText().catch(() => "");
  return { clase: textos.length ? "DESCONOCIDO" : "TIMEOUT", textos: [...textos, `BODY: ${cuerpo.replace(/\s+/g, " ").slice(0, 1500)}`] };
}

async function bajar(page: Page, accion: () => Promise<void>): Promise<Archivo> {
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }) as Promise<Download>, accion()]);
  const trozos: Buffer[] = [];
  for await (const t of await d.createReadStream()) trozos.push(t as Buffer);
  const nombre = d.suggestedFilename();
  return { nombre, datos: Buffer.concat(trozos), tipo: tipoPorNombre(nombre) };
}
export const bajarXml = (marco: Frame) => bajar(marco.page(), () => marco.locator(BOTON_XML).first().click());
export const bajarPdf = (marco: Frame) => bajar(marco.page(), () => marco.locator(BOTON_PDF).first().click());

/**
 * Cierra el modal «Resultado» con la X de su cabecera, y nada más. NUNCA
 * «Aceptar»: en «Error del Servidor» ese botón cierra la sesión de SOL
 * (confirmado el 30/09/2026). false = no se pudo; hay que volver por el menú.
 */
export async function cerrarModal(marco: Frame): Promise<boolean> {
  const x = marco.locator('ngb-modal-window .modal-header button.close, ngb-modal-window .modal-header button.btn-close, ngb-modal-window .modal-header [aria-label="Close"], ngb-modal-window .modal-header [aria-label="Cerrar"]');
  const n = await x.count().catch(() => 0);
  let clic = false;
  for (let i = 0; i < n && !clic; i++) {
    if (await x.nth(i).isVisible().catch(() => false)) { await x.nth(i).click({ timeout: 3000 }).catch(() => {}); clic = true; }
  }
  if (!clic) return false;
  for (let i = 0; i < 15; i++) {
    if (!(await marco.locator("ngb-modal-window").first().isVisible().catch(() => false))) return true;
    await marco.page().waitForTimeout(200);
  }
  return false;
}
