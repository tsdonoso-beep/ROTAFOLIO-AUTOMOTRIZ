// Trabajador «por API»: baja XML y PDF directo de api-cpe con el token de la sesión, sin pantallas.

import type { BrowserContext, Page } from "playwright";
import type { Bitacora } from "../comun/bitacora.mts";
import { clave, type Pendiente } from "../comun/tipos.mts";
import type { Tarea, Trabajador, Resultado } from "../comun/tuberia.mts";
import { abrirFormulario, entrar, nuevoContexto, Token } from "../sol/sesion.mts";
import { ClienteApi } from "./cliente.mts";

/**
 * Mantiene vivo el token: la primera vez y cada vez que vence o SUNAT
 * responde 401/403, reabre «Nueva Consulta» en una pestaña propia (la app pide
 * token nuevo al abrirse). Uno solo a la vez para todos los trabajadores.
 */
export class Renovador {
  token = new Token();
  private b: Bitacora;
  ctx: BrowserContext;
  private page: Page | null = null;
  private enCurso: Promise<void> | null = null;
  renovaciones = 0;

  /**
   * `pagina`: la pestaña donde se inició sesión, para abrir ahí el formulario
   * que da el token. Cerrarla y abrir otra perdía la sesión en GitHub Actions
   * (la nueva mostraba el ingreso), el segundo login pedía captcha y la
   * corrida moría antes de empezar (30/09/2026).
   */
  constructor(b: Bitacora, ctx: BrowserContext, pagina?: Page) {
    this.b = b;
    this.ctx = ctx;
    this.page = pagina ?? null;
    this.token.vigilar(ctx);
  }

  renovar(motivo: string): Promise<void> {
    if (this.enCurso) return this.enCurso;
    this.enCurso = (async () => {
      const anterior = this.token.valor;
      this.b.log("info", "token", `renovando token (${motivo})`);
      if (!this.page || this.page.isClosed()) {
        this.page = await this.ctx.newPage();
        this.page.on("dialog", d => {
          d.accept().catch(() => {});
        });
      }
      let abierto = true;
      try {
        await abrirFormulario(this.b, this.page, "token");
      } catch (e) {
        abierto = false;
        this.b.log("aviso", "token", `no se abrió el formulario: ${e instanceof Error ? e.message : e}`);
      }
      if (abierto) await this.esperarToken(anterior, 15000);
      // La app reusa el token guardado hasta que vence: si recargar devolvió el
      // mismo y ya está por vencer (o el formulario no abrió), sesión nueva en
      // un contexto limpio. Sin esto, un 401 volvía a pedir el mismo token en círculo.
      if (!abierto || !this.token.valor || (this.token.valor === anterior && !this.token.vigente(120))) await this.sesionNueva(anterior);
      if (!this.token.valor) throw new Error("la app no pidió token a api-cpe");
      this.renovaciones++;
      const vence = this.token.expira ? new Date(this.token.expira * 1000).toLocaleTimeString() : "?";
      this.b.log("info", "token", `token ${this.token.valor === anterior ? "igual al anterior" : "nuevo"} (vence ${vence})`);
    })().finally(() => {
      this.enCurso = null;
    });
    return this.enCurso;
  }

  private async esperarToken(anterior: string | null, ms: number) {
    const fin = Date.now() + ms;
    while (Date.now() < fin && (!this.token.valor || this.token.valor === anterior)) await new Promise(r => setTimeout(r, 250));
  }

  /** Otra sesión de SOL en un contexto nuevo; si da el token, pasa a ser la vigente y la vieja se cierra. */
  private async sesionNueva(anterior: string | null) {
    this.b.log("aviso", "token", "sesión nueva en un contexto limpio");
    const nav = this.ctx.browser();
    if (!nav) throw new Error("no hay navegador para abrir otra sesión");
    const ctx = await nuevoContexto(nav);
    this.token.vigilar(ctx);
    const page = await ctx.newPage();
    page.on("dialog", d => {
      d.accept().catch(() => {});
    });
    await entrar(this.b, page, "token");
    await abrirFormulario(this.b, page, "token");
    await this.esperarToken(anterior, 30000);
    const vieja = this.ctx;
    this.ctx = ctx;
    this.page = page;
    await vieja.close().catch(() => {});
  }

  async listo(): Promise<string> {
    if (!this.token.vigente()) await this.renovar(this.token.valor ? "vencido" : "inicio");
    return this.token.valor!;
  }
}

export class TrabajadorApi implements Trabajador {
  id: string;
  estado = "creado";
  desde = Date.now();
  private b: Bitacora;
  private api: ClienteApi;
  private renovador: Renovador;
  private conPdf: boolean;

  constructor(b: Bitacora, renovador: Renovador, n: number, conPdf: boolean) {
    this.b = b;
    this.renovador = renovador;
    this.conPdf = conPdf;
    this.id = `api${String(n).padStart(2, "0")}`;
    this.api = new ClienteApi(
      b,
      () => renovador.ctx.request,
      () => renovador.token.valor,
      this.id,
    );
  }

  destrabar() {
    /* cada pedido ya tiene su tope (AbortSignal.timeout) */
  }

  async procesar(t: Tarea): Promise<Resultado> {
    const p: Pendiente = t.p;
    const etiqueta = `${p.tipoComprobante} ${p.serie}-${p.numero} (${p.proveedorRuc})`;
    this.estado = "token";
    this.desde = Date.now();
    await this.renovador.listo();
    this.estado = "xml";
    this.desde = Date.now();
    const x = await this.api.archivo(p, "XML");
    // 2xx sin archivo adentro: no es OK aunque el estado lo diga.
    const clase = x.r.clase === "OK" && !x.archivo ? "DESCONOCIDO" : x.r.clase;
    this.b.jsonl("intentos.jsonl", {
      t: new Date().toISOString(),
      via: "api",
      trabajador: this.id,
      clave: clave(p),
      comprobante: etiqueta,
      intento: t.intentos + 1,
      clase,
      status: x.r.status,
      ms: x.r.ms,
      cuerpo: clase === "OK" ? undefined : x.r.texto.slice(0, 2000),
    });
    const detalle = clase === "OK" ? ` · ${x.archivo!.nombre}` : ` → HTTP ${x.r.status} ${x.r.texto.slice(0, 160)}`;
    this.b.log(clase === "OK" ? "info" : "aviso", this.id, `${etiqueta} intento ${t.intentos + 1}: ${clase} en ${x.r.ms} ms${detalle}`);
    if (clase === "SESION")
      await this.renovador
        .renovar(`HTTP ${x.r.status}`)
        .catch(e => this.b.log("error", this.id, `renovar token falló: ${e instanceof Error ? e.message : e}`));
    if (clase !== "OK") return { clase };
    return { clase, xml: x.archivo!, pedirPdf: this.conPdf ? () => this.bajarPdf(p) : undefined };
  }

  /**
   * El PDF, en la cola de PDF (no en el turno del trabajador). Da 500 mucho
   * más que el XML (14 de 31 pedidos en la corrida del 30/09/2026) y de forma
   * intermitente: 4 intentos espaciados (0, 3, 10, 30 s). Si igual no baja, el
   * XML se guarda sin PDF y queda en pdf-faltantes.jsonl para rellenarlo luego.
   */
  private async bajarPdf(p: Pendiente) {
    const esperas = [0, 3000, 10000, 30000];
    let status: number | null = null,
      cuerpo = "";
    for (const [i, espera] of esperas.entries()) {
      if (espera) await new Promise(r => setTimeout(r, espera));
      await this.renovador.listo();
      const r = await this.api.archivo(p, "PDF");
      if (r.archivo) {
        if (i > 0) this.b.log("info", "pdf", `${p.serie}-${p.numero}: PDF en el intento ${i + 1}`);
        return r.archivo;
      }
      status = r.r.status;
      cuerpo = r.r.texto.slice(0, 300);
    }
    this.b.log("aviso", "pdf", `${p.serie}-${p.numero}: sin PDF tras ${esperas.length} intentos (HTTP ${status}); se guarda el XML solo`);
    this.b.jsonl("pdf-faltantes.jsonl", { clave: clave(p), p, status, cuerpo });
    return null;
  }
}
