// Trabajador «por pantallas»: una pestaña de SOL que llena el formulario, consulta y baja XML+PDF.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Frame, Page, Response } from "playwright";
import { crudo, type Bitacora } from "../comun/bitacora.mts";
import { clave, type Clase } from "../comun/tipos.mts";
import type { Tarea, Trabajador, Resultado } from "../comun/tuberia.mts";
import { abrirFormulario, marcoFormulario, sesionCaida, entrar, ErrorSesion } from "./sesion.mts";
import { llenar, clicConsultar, esperarResultado, bajarXml, bajarPdf, cerrarModal } from "./formulario.mts";

let evidencias = 0;
const MAX_EVIDENCIAS = 300;

/** Un solo re-login a la vez por contexto, aunque varias pestañas lo pidan juntas. */
const relogins = new WeakMap<BrowserContext, Promise<void>>();
export function reloguear(b: Bitacora, ctx: BrowserContext, quien: string): Promise<void> {
  let p = relogins.get(ctx);
  if (!p) {
    p = (async () => {
      const pg = await ctx.newPage();
      pg.on("dialog", d => {
        d.accept().catch(() => {});
      });
      try {
        await entrar(b, pg, `${quien}/relogin`);
      } finally {
        await pg.close().catch(() => {});
        relogins.delete(ctx);
      }
    })();
    relogins.set(ctx, p);
  }
  return p;
}

export class TrabajadorUi implements Trabajador {
  id: string;
  estado = "creado";
  desde = Date.now();
  private b: Bitacora;
  private ctx: BrowserContext;
  private topeMs: number;
  private page: Page | null = null;
  private marco: Frame | null = null;
  private tipoActual: string | null = null;
  private dialogos: string[] = [];
  private consola: string[] = [];
  private red: Array<{ url: string; status: number; cuerpo?: string }> = [];

  constructor(b: Bitacora, ctx: BrowserContext, n: number, topeResultadoMs: number) {
    this.b = b;
    this.ctx = ctx;
    this.topeMs = topeResultadoMs;
    this.id = `ui${String(n).padStart(2, "0")}`;
  }

  private fase(nombre: string) {
    this.estado = nombre;
    this.desde = Date.now();
  }

  private async pagina(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    const p = await this.ctx.newPage();
    // Aceptar, no descartar: descartar un «beforeunload» cancela la navegación (net::ERR_ABORTED).
    p.on("dialog", d => {
      this.dialogos.push(`${d.type()}: ${d.message()}`);
      d.accept().catch(() => {});
    });
    p.on("console", m => {
      if (m.type() === "error") this.consola.push(m.text().slice(0, 500));
    });
    p.on("pageerror", e => this.consola.push(`pageerror: ${e.message.slice(0, 500)}`));
    p.on("response", r => {
      void this.anotarRespuesta(r);
    });
    this.page = p;
    this.marco = null;
    this.tipoActual = null;
    return p;
  }

  private async anotarRespuesta(r: Response) {
    const url = r.url();
    if (!/sunat\.gob\.pe/i.test(url) || /gettime\.pl/i.test(url)) return;
    const tipo = r.request().resourceType();
    if (tipo !== "xhr" && tipo !== "fetch" && r.status() < 400) return;
    const cuerpo = /json|text|html/i.test(r.headers()["content-type"] ?? "") ? (await r.text().catch(() => "")).slice(0, 2000) : undefined;
    this.b.http({ metodo: r.request().method(), url, status: r.status(), cuerpo, quien: this.id });
    this.red.push({ url: url.slice(0, 300), status: r.status(), cuerpo });
    if (this.red.length > 40) this.red.shift();
  }

  destrabar() {
    void this.page?.close().catch(() => {});
    this.page = null;
    this.marco = null;
  }

  async procesar(t: Tarea): Promise<Resultado> {
    const p = t.p;
    const etiqueta = `${p.tipoComprobante} ${p.serie}-${p.numero} (${p.proveedorRuc})`;
    this.dialogos = [];
    this.consola = [];
    this.red = [];
    const fases: Record<string, number> = {};
    const medir = async <T,>(f: string, fn: () => Promise<T>): Promise<T> => {
      this.fase(f);
      const t0 = Date.now();
      try {
        return await fn();
      } finally {
        fases[f] = Date.now() - t0;
      }
    };
    let clase: Clase = "EXCEPCION",
      textos: string[] = [],
      error: ReturnType<typeof crudo> | undefined,
      reuso = false;
    let r: Resultado = { clase };
    try {
      const page = await this.pagina();
      if (this.marco && (await marcoFormulario(page)) === this.marco) reuso = true;
      else {
        this.marco = await medir("menu", () => abrirFormulario(this.b, page, this.id));
        this.tipoActual = null;
      }
      const marco = this.marco!;
      this.tipoActual = await medir("llenar", () => llenar(marco, p, this.tipoActual));
      await medir("consultar", () => clicConsultar(marco));
      ({ clase, textos } = await medir("esperar", () => esperarResultado(marco, this.topeMs, () => this.dialogos)));
      if (clase === "OK") {
        const xml = await medir("bajar_xml", () => bajarXml(marco));
        const pdf = await medir("bajar_pdf", () => bajarPdf(marco)).catch(() => null);
        r = { clase, xml, pdf };
      } else r = { clase };
      // Solo tras un OK se reusa el formulario; cualquier otro modal se abandona sin tocarlo.
      if (!(clase === "OK" && (await medir("cerrar", () => cerrarModal(marco))))) this.marco = null;
    } catch (e) {
      error = crudo(e);
      clase = e instanceof ErrorSesion ? "SESION" : "EXCEPCION";
      r = { clase };
      this.marco = null;
    }
    if (this.page && (await sesionCaida(this.page).catch(() => false))) {
      clase = "SESION";
      r = { clase };
    }

    const ms = Object.values(fases).reduce((a, x) => a + x, 0);
    this.b.jsonl("intentos.jsonl", {
      t: new Date().toISOString(),
      via: "ui",
      trabajador: this.id,
      clave: clave(p),
      comprobante: etiqueta,
      intento: t.intentos + 1,
      clase,
      reuso,
      ms,
      fases,
      textos,
      error,
      dialogos: this.dialogos,
      consola: this.consola.slice(-10),
      red: this.red.filter(x => x.status >= 400 || x.cuerpo),
    });
    const detalle = clase === "OK" ? "" : ` → ${error ? error.mensaje.split("\n")[0].slice(0, 160) : (textos[0]?.slice(0, 160) ?? "")}`;
    this.b.log(
      clase === "OK" ? "info" : "aviso",
      this.id,
      `${etiqueta} intento ${t.intentos + 1}: ${clase} en ${(ms / 1000).toFixed(1)}s${reuso ? " (form reusado)" : ""}${detalle}`,
    );
    if (clase !== "OK" && clase !== "NO_EXISTE") await this.evidencia(`${p.serie}-${p.numero}-i${t.intentos + 1}-${clase}`);
    if (clase === "SESION")
      await reloguear(this.b, this.ctx, this.id).catch(e =>
        this.b.log("error", this.id, `re-login falló: ${crudo(e).mensaje.split("\n")[0]}`),
      );
    return r;
  }

  private async evidencia(nombre: string) {
    if (!this.page || this.page.isClosed() || evidencias >= MAX_EVIDENCIAS) return;
    evidencias++;
    const base = join(this.b.dir, "errores", `${this.id}-${nombre}`);
    await this.page.screenshot({ path: `${base}.png`, fullPage: true, timeout: 15000 }).catch(() => {});
    if (this.marco) writeFileSync(`${base}.frame.html`, await this.marco.content().catch(() => ""));
  }
}
