// Las etapas de una corrida, por separado: SUNAT → PDF → Drive → Supabase → hoja.
//
// Cada una tiene sus números y su hora de fin. Cuando una termina se anota en
// la bitácora («✔ etapa Drive terminada…»), y todo el estado se escribe a
// estado.json en cada latido: se puede mirar desde otra terminal
// (`pnpm cpe:estado`) sin tocar la corrida.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Bitacora } from "./bitacora.mts";
import { duracion } from "./barra.mts";

export type NombreEtapa = "sunat" | "pdf" | "drive" | "base" | "hoja";
export const ORDEN: NombreEtapa[] = ["sunat", "pdf", "drive", "base", "hoja"];
export const TITULO: Record<NombreEtapa, string> = {
  sunat: "SUNAT (API)",
  pdf: "PDF",
  drive: "Drive",
  base: "Supabase",
  hoja: "Hoja de detalle",
};

export interface Etapa {
  estado: "esperando" | "en curso" | "terminada" | "omitida";
  inicio: number | null;
  fin: number | null;
  /** Contadores propios de la etapa (ok, fallidos, en cola…). */
  n: Record<string, number>;
}

export class Etapas {
  private b: Bitacora;
  private t0 = Date.now();
  e: Record<NombreEtapa, Etapa>;

  constructor(b: Bitacora) {
    this.b = b;
    this.e = Object.fromEntries(ORDEN.map(k => [k, { estado: "esperando", inicio: null, fin: null, n: {} }])) as unknown as Record<
      NombreEtapa,
      Etapa
    >;
  }

  sumar(k: NombreEtapa, contador: string, cuanto = 1) {
    const et = this.e[k];
    if (et.estado === "esperando") {
      et.estado = "en curso";
      et.inicio = Date.now();
    }
    et.n[contador] = (et.n[contador] ?? 0) + cuanto;
  }

  fijar(k: NombreEtapa, contador: string, valor: number) {
    this.e[k].n[contador] = valor;
  }

  /** La marca terminada una sola vez, si la anterior ya terminó y no queda nada suyo pendiente. */
  cerrarSi(k: NombreEtapa, sinPendientes: boolean) {
    const et = this.e[k];
    if (et.estado === "terminada" || et.estado === "omitida" || !sinPendientes) return;
    const i = ORDEN.indexOf(k);
    const previa = i > 0 ? this.e[ORDEN[i - 1]] : null;
    if (previa && previa.estado !== "terminada" && previa.estado !== "omitida") return;
    et.estado = "terminada";
    et.fin = Date.now();
    et.inicio ??= et.fin;
    const nums =
      Object.entries(et.n)
        .map(([c, v]) => `${c} ${v}`)
        .join(", ") || "sin nada que hacer";
    this.b.log(
      "info",
      "etapa",
      `✔ ${TITULO[k]} terminada a los ${duracion(et.fin - this.t0)} de empezar (${duracion(et.fin - et.inicio)} de trabajo): ${nums}`,
    );
  }

  omitir(k: NombreEtapa, motivo: string) {
    this.e[k].estado = "omitida";
    this.b.log("info", "etapa", `— ${TITULO[k]} omitida: ${motivo}`);
  }

  instantanea(extra: Record<string, unknown> = {}) {
    return {
      actualizado: new Date().toISOString(),
      corrida: this.b.corrida,
      minutos: Number(((Date.now() - this.t0) / 60000).toFixed(1)),
      etapas: Object.fromEntries(
        ORDEN.map(k => {
          const et = this.e[k];
          return [
            k,
            {
              titulo: TITULO[k],
              estado: et.estado,
              ...et.n,
              inicio: et.inicio && new Date(et.inicio).toISOString(),
              fin: et.fin && new Date(et.fin).toISOString(),
              duracion: et.inicio ? duracion((et.fin ?? Date.now()) - et.inicio) : null,
            },
          ];
        }),
      ),
      ...extra,
    };
  }

  escribir(extra: Record<string, unknown> = {}) {
    try {
      writeFileSync(join(this.b.dir, "estado.json"), JSON.stringify(this.instantanea(extra), null, 2));
    } catch {
      /* nunca tumba la corrida */
    }
  }
}
