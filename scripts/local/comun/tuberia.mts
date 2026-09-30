// La tubería: cola de consultas → cola de subidas a Drive → lotes a la base.
// Es la misma para cualquier forma de consultar a SUNAT (pantallas o API): un
// «trabajador» solo tiene que saber procesar UNA tarea y decir cómo le fue.

import { dormir, crudo, primeraLinea, type Bitacora } from "./bitacora.mts";
import { clave, decidir, type Clase, type Pendiente, type Politica } from "./tipos.mts";
import { statsDrive, type Archivo } from "./drive.mts";
import { ARCHIVO_NO_EXISTE } from "./base.mts";
import { Salida } from "./salida.mts";
import { appendFileSync } from "node:fs";
import { Etapas } from "./etapas.mts";

export interface Tarea {
  p: Pendiente;
  intentos: number;
  noAntesDe: number;
  historial: Clase[];
}
/**
 * `pdf`: ya bajado (vía pantallas). `pedirPdf`: se baja después, en la cola de
 * PDF, para que el trabajador no se quede esperando al paso más inestable de
 * SUNAT (vía API: el XML tarda ~300 ms; el PDF, con sus reintentos, hasta 30 s).
 */
export interface Resultado {
  clase: Clase;
  xml?: Archivo;
  pdf?: Archivo | null;
  pedirPdf?: () => Promise<Archivo | null>;
  detalle?: string;
}

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
  umbralCaido: number; // 0..1
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
  private recientes: Array<{ t: number; clase: Clase }> = [];
  etapas: Etapas;
  salida: Salida;
  private inicio = Date.now();
  private b: Bitacora;
  private o: Opciones;
  total: number;

  // Sin «parameter properties» (`private b` en la firma): Node, al solo quitar tipos, no las acepta.
  constructor(b: Bitacora, pendientes: Pendiente[], o: Opciones) {
    this.b = b;
    this.o = o;
    this.etapas = new Etapas(b);
    this.etapas.fijar("sunat", "total", pendientes.length);
    this.salida = new Salida(b, o, this.etapas, () => this.revisarEtapas());
    for (const p of pendientes) this.cola.push({ p, intentos: 0, noAntesDe: 0, historial: [] });
    this.total = pendientes.length;
  }

  tomar(): Tarea | null {
    const ahora = Date.now();
    const i = this.cola.findIndex(t => t.noAntesDe <= ahora);
    return i < 0 ? null : this.cola.splice(i, 1)[0];
  }
  quedaTrabajo() {
    return this.cola.length > 0 || this.enVuelo > 0;
  }

  async correr(w: Trabajador, retrasoMs: number): Promise<void> {
    await dormir(retrasoMs);
    this.b.log("info", w.id, "arranca");
    while (!this.detener) {
      if (Date.now() < this.pausaHasta) {
        w.estado = "pausa";
        w.desde = Date.now();
        await dormir(Math.min(5000, this.pausaHasta - Date.now()));
        continue;
      }
      const t = this.tomar();
      if (!t) {
        if (!this.quedaTrabajo()) break;
        w.estado = "sin-tarea";
        w.desde = Date.now();
        await dormir(1000);
        continue;
      }
      this.enVuelo++;
      let r: Resultado;
      try {
        r = await w.procesar(t);
      } catch (e) {
        this.b.log("error", w.id, `procesar() reventó: ${primeraLinea(e)}`, { error: crudo(e) });
        r = { clase: "EXCEPCION" };
      } finally {
        this.enVuelo--;
      }
      this.anotar(t, r, w.id);
    }
    w.estado = "terminado";
    w.desde = Date.now();
    this.b.log("info", w.id, "termina");
  }

  private anotar(t: Tarea, r: Resultado, quien: string) {
    this.porClase[r.clase] = (this.porClase[r.clase] ?? 0) + 1;
    this.etapas.sumar("sunat", "intentos");
    t.historial.push(r.clase);
    this.vigilarCaidas(r.clase);
    if (r.clase === "OK" && r.xml) this.salida.recibir(t.p, r.xml, r.pdf ?? null, r.pedirPdf);
    const d = decidir(r.clase, t.intentos + 1, this.o.politica);
    if (d.accion === "reintentar") {
      if (d.cuentaIntento) t.intentos++;
      t.noAntesDe = Date.now() + d.esperaMs;
      if (d.esperaMs === 0) this.cola.unshift(t);
      else this.cola.push(t);
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
      this.b.log(
        "aviso",
        "tuberia",
        `SUNAT caído en ${caidos}/${this.recientes.length} de los últimos 2 min: pausa de ${this.o.pausaCaidoMs / 1000}s`,
      );
    }
  }

  /** Lo guardado en Supabase en esta corrida. */
  get base() {
    return this.salida.base;
  }
  volcar(): Promise<void> {
    return this.salida.volcar();
  }

  /** Marca terminada cada etapa cuando ya no le queda nada (en orden: SUNAT → PDF → Drive → Supabase). */
  revisarEtapas() {
    const e = this.etapas;
    e.fijar("sunat", "en_cola", this.cola.length);
    const { pdfs, subidas } = this.salida;
    e.fijar("pdf", "en_cola", pdfs.enEspera + pdfs.enCurso);
    e.fijar("drive", "en_cola", subidas.enEspera + subidas.enCurso);
    e.fijar("base", "en_espera", this.salida.enBuffer);
    e.cerrarSi("sunat", this.cola.length === 0 && this.enVuelo === 0);
    e.cerrarSi("pdf", pdfs.vacia);
    e.cerrarSi("drive", subidas.vacia);
    e.cerrarSi("base", this.salida.baseVacia);
  }

  /** Espera a que termine todo lo subido y guardado. */
  async cerrar(): Promise<void> {
    await this.salida.cerrar();
    this.revisarEtapas();
  }

  latido(ws: Trabajador[]) {
    this.revisarEtapas();
    this.etapas.escribir({ progreso: this.progreso() });
    const min = (Date.now() - this.inicio) / 60000;
    const ritmo = this.finales.ok / Math.max(min, 0.1);
    const resta = this.total - this.finales.ok - this.finales.noExiste - this.finales.agotados;
    const esperando = this.cola.filter(t => t.noAntesDe > Date.now()).length;
    this.b.log(
      "info",
      "latido",
      `${min.toFixed(1)} min · OK ${this.finales.ok} · no existe ${this.finales.noExiste} · agotados ${this.finales.agotados} · cola ${this.cola.length} (${esperando} en espera) · en vuelo ${this.enVuelo} · pdf ${this.salida.pdfs.enEspera}+${this.salida.pdfs.enCurso} · subidas ${this.salida.subidas.enEspera}+${this.salida.subidas.enCurso} · ${ritmo.toFixed(1)}/min · ETA ${ritmo > 0 ? Math.round(resta / ritmo) + " min" : "?"}`,
      {
        porClase: this.porClase,
        trabajadores: ws.map(w => ({ id: w.id, estado: w.estado, s: Math.round((Date.now() - w.desde) / 1000) })),
      },
    );
  }

  vigilar(ws: Trabajador[]) {
    for (const w of ws) {
      if (["terminado", "pausa", "sin-tarea", "creado"].includes(w.estado)) continue;
      const s = Date.now() - w.desde;
      if (s > this.o.watchdogMs) {
        this.b.log("error", "vigilante", `${w.id} colgado en «${w.estado}» hace ${Math.round(s / 1000)}s: se destraba`);
        w.estado = `${w.estado}-destrabando`;
        w.desde = Date.now();
        w.destrabar();
      }
    }
  }

  /** Lo que muestra la barra de progreso. */
  progreso() {
    const cerrados = this.finales.noExiste + this.finales.agotados + statsDrive.fallidos;
    return {
      hechos: this.base.guardados + cerrados,
      total: this.total,
      ok: this.base.guardados,
      consultados: this.finales.ok + cerrados,
      enVuelo: this.enVuelo,
      inicio: this.inicio,
      enEspera: this.cola.filter(t => t.intentos > 0).length,
      subidas: this.salida.pendientes,
    };
  }

  resumen<E extends Record<string, unknown>>(extra: E) {
    const minutos = (Date.now() - this.inicio) / 60000;
    return {
      minutos: Number(minutos.toFixed(1)),
      total: this.total,
      finales: this.finales,
      porClase: this.porClase,
      drive: statsDrive,
      base: this.base,
      quedanEnCola: this.cola.length,
      okPorHora: Math.round(this.finales.ok / Math.max(minutos / 60, 0.01)),
      ...extra,
    };
  }
}
