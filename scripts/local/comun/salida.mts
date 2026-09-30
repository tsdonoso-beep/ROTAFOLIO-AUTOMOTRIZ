// Las colas de salida de la tubería: PDF → Drive → Supabase (en lotes).
//
// Cada una con su propio paralelo: el trabajador de SUNAT deja lo bajado aquí
// y sigue con otro sin esperar al PDF, a Drive ni a la base.

import { dormir, primeraLinea, type Bitacora } from "./bitacora.mts";
import type { Pendiente } from "./tipos.mts";
import { archivar, type Archivo } from "./drive.mts";
import { guardarLote, type Confirmado } from "./guardar.mts";
import type { Etapas } from "./etapas.mts";

export interface OpcionesSalida {
  subidasEnParalelo: number;
  pdfEnParalelo: number;
  loteGuardado: number;
}

type Trabajo = () => Promise<void>;

/** Una cola con N trabajos a la vez. */
class Cola {
  private espera: Trabajo[] = [];
  enCurso = 0;
  private paralelo: number;
  private alFallar: (e: unknown) => void;
  constructor(paralelo: number, alFallar: (e: unknown) => void) {
    this.paralelo = paralelo;
    this.alFallar = alFallar;
  }
  get enEspera() {
    return this.espera.length;
  }
  get vacia() {
    return this.espera.length === 0 && this.enCurso === 0;
  }
  poner(t: Trabajo) {
    this.espera.push(t);
    this.bombear();
  }
  private bombear() {
    while (this.enCurso < this.paralelo && this.espera.length) {
      const t = this.espera.shift()!;
      this.enCurso++;
      t()
        .catch(this.alFallar)
        .finally(() => {
          this.enCurso--;
          this.bombear();
        });
    }
  }
}

export class Salida {
  base = { guardados: 0, items: 0 };
  pdfs: Cola;
  subidas: Cola;
  private buffer: Confirmado[] = [];
  private cadena: Promise<void> = Promise.resolve();
  private guardando = 0;
  private b: Bitacora;
  private o: OpcionesSalida;
  private etapas: Etapas;
  private alCambiar: () => void;

  constructor(b: Bitacora, o: OpcionesSalida, etapas: Etapas, alCambiar: () => void) {
    this.b = b;
    this.o = o;
    this.etapas = etapas;
    this.alCambiar = alCambiar;
    this.pdfs = new Cola(o.pdfEnParalelo, e => b.log("error", "pdf", `reventó: ${primeraLinea(e)}`));
    this.subidas = new Cola(o.subidasEnParalelo, e => b.log("error", "drive", `subida reventó: ${primeraLinea(e)}`));
  }

  /** Lo bajado de SUNAT: con el PDF ya en mano (pantallas) o con cómo pedirlo (API). */
  recibir(p: Pendiente, xml: Archivo, pdf: Archivo | null, pedirPdf?: () => Promise<Archivo | null>) {
    if (!pedirPdf) return this.subir(p, xml, pdf);
    this.pdfs.poner(async () => {
      const bajado = await pedirPdf().catch(e => {
        this.b.log("aviso", "pdf", `${p.serie}-${p.numero}: ${primeraLinea(e)}`);
        return null;
      });
      this.etapas.sumar("pdf", bajado ? "ok" : "faltantes");
      this.subir(p, xml, bajado);
    });
  }

  private subir(p: Pendiente, xml: Archivo, pdf: Archivo | null) {
    this.subidas.poner(async () => {
      const c = await archivar(this.b, `${p.serie}-${p.numero}`, p.periodo, xml, pdf);
      this.etapas.sumar("drive", c ? "ok" : "fallidos");
      if (c) {
        this.buffer.push(c);
        if (this.buffer.length >= this.o.loteGuardado) void this.volcar();
      }
    });
  }

  volcar(): Promise<void> {
    const lote = this.buffer;
    this.buffer = [];
    if (lote.length) {
      this.guardando++;
      this.cadena = this.cadena
        .then(async () => {
          const r = await guardarLote(this.b, lote);
          this.base.guardados += r.guardados;
          this.base.items += r.items;
          this.etapas.sumar("base", "guardados", r.guardados);
          this.etapas.sumar("base", "ítems", r.items);
          if (r.guardados === 0) this.etapas.sumar("base", "lotes_fallidos");
        })
        .catch(e => this.b.log("error", "base", `volcado reventó: ${primeraLinea(e)}`))
        .finally(() => {
          this.guardando--;
          this.alCambiar();
        });
    }
    return this.cadena;
  }

  get enBuffer() {
    return this.buffer.length;
  }
  get baseVacia() {
    return this.buffer.length === 0 && this.guardando === 0;
  }
  /** PDF + Drive pendientes. */
  get pendientes() {
    return this.pdfs.enEspera + this.pdfs.enCurso + this.subidas.enEspera + this.subidas.enCurso;
  }

  /** Espera a que termine todo lo subido y guardado. */
  async cerrar(): Promise<void> {
    while (!this.pdfs.vacia || !this.subidas.vacia) await dormir(500);
    await this.volcar();
  }
}
