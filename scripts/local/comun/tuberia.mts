// La tubería: cola de consultas → cola de subidas a Drive → lotes a la base.
// Es la misma para cualquier forma de consultar a SUNAT (pantallas o API): un
// «trabajador» solo tiene que saber procesar UNA tarea y decir cómo le fue.

import { dormir, crudo, primeraLinea, type Bitacora } from "./bitacora.mts";
import { clave, decidir, type Clase, type Pendiente, type Politica } from "./tipos.mts";
import { archivar, statsDrive, type Archivo } from "./drive.mts";
import { guardarLote, ARCHIVO_NO_EXISTE, type Confirmado } from "./base.mts";
import { appendFileSync } from "node:fs";
import { Etapas } from "./etapas.mts";

export interface Tarea { p: Pendiente; intentos: number; noAntesDe: number; historial: Clase[] }
/**
 * `pdf`: ya bajado (vía pantallas). `pedirPdf`: se baja después, en la cola de
 * PDF, para que el trabajador no se quede esperando al paso más inestable de
 * SUNAT (vía API: el XML tarda ~300 ms; el PDF, con sus reintentos, hasta 30 s).
 */
export interface Resultado { clase: Clase; xml?: Archivo; pdf?: Archivo | null; pedirPdf?: () => Promise<Archivo | null>; detalle?: string }

/** Lo mínimo que la tubería necesita de un trabajador. */
export interface Trabajador {
  id: string;
  estado: string;
  desde: number;
  procesar(t: Tarea): Promise<Resultado>;
  /** Se llama cuando el vigilante lo ve colgado: debe cortar lo que esté haciendo. */
  destrabar(): void;
}

export interface Opciones {
  politica: Politica;
  subidasEnParalelo: number;
  pdfEnParalelo: number;
  loteGuardado: number;
  umbralCaido: number;      // 0..1
  pausaCaidoMs: number;
  watchdogMs: number;
}

export class Tuberia {
  cola: Tarea[] = [];
  enVuelo = 0;
  detener = false;
  pausaHasta = 0;
  finales = { ok: 0, noExiste: 0, agotados: 0 };
  porClase: Record<string, number> = {};
  base = { guardados: 0, items: 0 };
  private recientes: Array<{ t: number; clase: Clase }> = [];
  private subidas: Array<() => Promise<void>> = [];
  private subiendo = 0;
  private pdfs: Array<() => Promise<void>> = [];
  private bajandoPdf = 0;
  private buffer: Confirmado[] = [];
  private cadena: Promise<void> = Promise.resolve();
  private guardando = 0;
  etapas: Etapas;
  private inicio = Date.now();
  private b: Bitacora;
  private o: Opciones;
  total: number;

  // Sin «parameter properties» (`private b` en la firma): Node, al solo quitar tipos, no las acepta.
  constructor(b: Bitacora, pendientes: Pendiente[], o: Opciones) {
    this.b = b; this.o = o;
    this.etapas = new Etapas(b);
    this.etapas.fijar("sunat", "total", pendientes.length);
    for (const p of pendientes) this.cola.push({ p, intentos: 0, noAntesDe: 0, historial: [] });
    this.total = pendientes.length;
  }

  tomar(): Tarea | null {
    const ahora = Date.now();
    const i = this.cola.findIndex(t => t.noAntesDe <= ahora);
    return i < 0 ? null : this.cola.splice(i, 1)[0];
  }
  quedaTrabajo() { return this.cola.length > 0 || this.enVuelo > 0; }

  async correr(w: Trabajador, retrasoMs: number): Promise<void> {
    await dormir(retrasoMs);
    this.b.log("info", w.id, "arranca");
    while (!this.detener) {
      if (Date.now() < this.pausaHasta) { w.estado = "pausa"; w.desde = Date.now(); await dormir(Math.min(5000, this.pausaHasta - Date.now())); continue; }
      const t = this.tomar();
      if (!t) {
        if (!this.quedaTrabajo()) break;
        w.estado = "sin-tarea"; w.desde = Date.now(); await dormir(1000); continue;
      }
      this.enVuelo++;
      let r: Resultado;
      try { r = await w.procesar(t); }
      catch (e) { this.b.log("error", w.id, `procesar() reventó: ${primeraLinea(e)}`, { error: crudo(e) }); r = { clase: "EXCEPCION" }; }
      finally { this.enVuelo--; }
      this.anotar(t, r, w.id);
    }
    w.estado = "terminado"; w.desde = Date.now();
    this.b.log("info", w.id, "termina");
  }

  private anotar(t: Tarea, r: Resultado, quien: string) {
    this.porClase[r.clase] = (this.porClase[r.clase] ?? 0) + 1;
    this.etapas.sumar("sunat", "intentos");
    t.historial.push(r.clase);
    this.vigilarCaidas(r.clase);
    if (r.clase === "OK" && r.xml) {
      if (r.pedirPdf) this.encolarPdf(t.p, r.xml, r.pedirPdf);
      else this.encolarSubida(t.p, r.xml, r.pdf ?? null);
    }
    const d = decidir(r.clase, t.intentos + 1, this.o.politica);
    if (d.accion === "reintentar") {
      if (d.cuentaIntento) t.intentos++;
      t.noAntesDe = Date.now() + d.esperaMs;
      if (d.esperaMs === 0) this.cola.unshift(t); else this.cola.push(t);
      return;
    }
    t.intentos++;
    this.etapas.sumar("sunat", d.motivo);
    if (d.motivo === "ok") this.finales.ok++;
    else if (d.motivo === "no_existe") {
      this.finales.noExiste++;
      appendFileSync(ARCHIVO_NO_EXISTE, JSON.stringify({ t: new Date().toISOString(), clave: clave(t.p), p: t.p }) + "\n");
    } else {
      this.finales.agotados++;
      this.b.log("error", quien, `${t.p.serie}-${t.p.numero}: se rinde tras ${t.intentos} intentos (${t.historial.join(", ")})`);
      this.b.jsonl("agotados.jsonl", { clave: clave(t.p), p: t.p, historial: t.historial });
    }
  }

  /** Si casi todo lo de los últimos 2 min fue «SUNAT caído», pausa a todos en vez de seguir martillando. */
  private vigilarCaidas(clase: Clase) {
    const ahora = Date.now();
    this.recientes.push({ t: ahora, clase });
    while (this.recientes.length && this.recientes[0].t < ahora - 120_000) this.recientes.shift();
    if (clase !== "SUNAT_CAIDO" || this.recientes.length < 10 || this.pausaHasta > ahora) return;
    const caidos = this.recientes.filter(r => r.clase === "SUNAT_CAIDO").length;
    if (caidos / this.recientes.length >= this.o.umbralCaido) {
      this.pausaHasta = ahora + this.o.pausaCaidoMs;
      this.b.log("aviso", "tuberia", `SUNAT caído en ${caidos}/${this.recientes.length} de los últimos 2 min: pausa de ${this.o.pausaCaidoMs / 1000}s`);
    }
  }

  private encolarPdf(p: Pendiente, xml: Archivo, pedirPdf: () => Promise<Archivo | null>) {
    this.pdfs.push(async () => {
      const pdf = await pedirPdf().catch(e => { this.b.log("aviso", "pdf", `${p.serie}-${p.numero}: ${primeraLinea(e)}`); return null; });
      this.etapas.sumar("pdf", pdf ? "ok" : "faltantes");
      this.encolarSubida(p, xml, pdf);
    });
    this.bombearPdf();
  }
  private bombearPdf() {
    while (this.bajandoPdf < this.o.pdfEnParalelo && this.pdfs.length) {
      const job = this.pdfs.shift()!;
      this.bajandoPdf++;
      job().finally(() => { this.bajandoPdf--; this.bombearPdf(); });
    }
  }

  private encolarSubida(p: Pendiente, xml: Archivo, pdf: Archivo | null) {
    this.subidas.push(async () => {
      const c = await archivar(this.b, `${p.serie}-${p.numero}`, p.periodo, xml, pdf);
      this.etapas.sumar("drive", c ? "ok" : "fallidos");
      if (c) { this.buffer.push(c); if (this.buffer.length >= this.o.loteGuardado) void this.volcar(); }
    });
    this.bombear();
  }
  private bombear() {
    while (this.subiendo < this.o.subidasEnParalelo && this.subidas.length) {
      const job = this.subidas.shift()!;
      this.subiendo++;
      job().catch(e => this.b.log("error", "drive", `subida reventó: ${primeraLinea(e)}`)).finally(() => { this.subiendo--; this.bombear(); });
    }
  }

  volcar(): Promise<void> {
    const lote = this.buffer;
    this.buffer = [];
    if (lote.length) {
      this.guardando++;
      this.cadena = this.cadena.then(async () => {
        const r = await guardarLote(this.b, lote);
        this.base.guardados += r.guardados; this.base.items += r.items;
        this.etapas.sumar("base", "guardados", r.guardados); this.etapas.sumar("base", "ítems", r.items);
        if (r.guardados === 0) this.etapas.sumar("base", "lotes_fallidos");
      }).catch(e => this.b.log("error", "base", `volcado reventó: ${primeraLinea(e)}`)).finally(() => { this.guardando--; this.revisarEtapas(); });
    }
    return this.cadena;
  }

  /** Marca terminada cada etapa cuando ya no le queda nada (en orden: SUNAT → PDF → Drive → Supabase). */
  revisarEtapas() {
    const e = this.etapas;
    e.fijar("sunat", "en_cola", this.cola.length);
    e.fijar("pdf", "en_cola", this.pdfs.length + this.bajandoPdf);
    e.fijar("drive", "en_cola", this.subidas.length + this.subiendo);
    e.fijar("base", "en_espera", this.buffer.length);
    e.cerrarSi("sunat", this.cola.length === 0 && this.enVuelo === 0);
    e.cerrarSi("pdf", this.pdfs.length === 0 && this.bajandoPdf === 0);
    e.cerrarSi("drive", this.subidas.length === 0 && this.subiendo === 0);
    e.cerrarSi("base", this.buffer.length === 0 && this.guardando === 0);
  }

  /** Espera a que termine todo lo subido y guardado. */
  async cerrar(): Promise<void> {
    while (this.pdfs.length || this.bajandoPdf || this.subidas.length || this.subiendo) await dormir(500);
    await this.volcar();
    this.revisarEtapas();
  }

  latido(ws: Trabajador[]) {
    this.revisarEtapas();
    this.etapas.escribir({ progreso: this.progreso() });
    const min = (Date.now() - this.inicio) / 60000;
    const ritmo = this.finales.ok / Math.max(min, 0.1);
    const resta = this.total - this.finales.ok - this.finales.noExiste - this.finales.agotados;
    const esperando = this.cola.filter(t => t.noAntesDe > Date.now()).length;
    this.b.log("info", "latido", `${min.toFixed(1)} min · OK ${this.finales.ok} · no existe ${this.finales.noExiste} · agotados ${this.finales.agotados} · cola ${this.cola.length} (${esperando} en espera) · en vuelo ${this.enVuelo} · pdf ${this.pdfs.length}+${this.bajandoPdf} · subidas ${this.subidas.length}+${this.subiendo} · ${ritmo.toFixed(1)}/min · ETA ${ritmo > 0 ? Math.round(resta / ritmo) + " min" : "?"}`,
      { porClase: this.porClase, trabajadores: ws.map(w => ({ id: w.id, estado: w.estado, s: Math.round((Date.now() - w.desde) / 1000) })) });
  }

  vigilar(ws: Trabajador[]) {
    for (const w of ws) {
      if (["terminado", "pausa", "sin-tarea", "creado"].includes(w.estado)) continue;
      const s = Date.now() - w.desde;
      if (s > this.o.watchdogMs) {
        this.b.log("error", "vigilante", `${w.id} colgado en «${w.estado}» hace ${Math.round(s / 1000)}s: se destraba`);
        w.estado = `${w.estado}-destrabando`; w.desde = Date.now();
        w.destrabar();
      }
    }
  }

  /** Lo que muestra la barra de progreso. */
  progreso() {
    const cerrados = this.finales.noExiste + this.finales.agotados + statsDrive.fallidos;
    return {
      hechos: this.base.guardados + cerrados, total: this.total, ok: this.base.guardados, consultados: this.finales.ok + cerrados,
      enVuelo: this.enVuelo, inicio: this.inicio,
      enEspera: this.cola.filter(t => t.intentos > 0).length,
      subidas: this.pdfs.length + this.bajandoPdf + this.subidas.length + this.subiendo,
    };
  }

  resumen<E extends Record<string, unknown>>(extra: E) {
    const minutos = (Date.now() - this.inicio) / 60000;
    return {
      minutos: Number(minutos.toFixed(1)), total: this.total, finales: this.finales, porClase: this.porClase,
      drive: statsDrive, base: this.base, quedanEnCola: this.cola.length,
      okPorHora: Math.round(this.finales.ok / Math.max(minutos / 60, 0.01)), ...extra,
    };
  }
}
