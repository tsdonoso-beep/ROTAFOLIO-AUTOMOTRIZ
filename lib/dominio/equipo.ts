// Lo que un líder necesita ver de su gente
//
// De la reunión: "acá están tus cinco personas que están yendo, es la
// responsabilidad de tu área — eso a ustedes los libera, ya monitorean al
// líder y no a cada persona". Hoy Administración persigue de a uno a
// ciento cincuenta; la idea es que persiga a los líderes, y que cada líder
// vea de un vistazo quién de los suyos debe rendir.
//
// El corte es por persona, no por memo: la pregunta de una jefatura es
// "¿quién me debe y desde cuándo?", no "¿cómo va el memo tal?".
//
// `hoy` se recibe como argumento en vez de leer el reloj adentro. Así la
// función es pura y se puede probar el atraso sin depender del día en que
// corran las pruebas.

import { consolidar } from "./memo.ts";
import type { EstadoMemo, Gasto } from "./tipos.ts";

/**
 * Los memos que la persona todavía no cerró.
 *
 * No se reutiliza MEMO_PENDIENTE porque esa lista responde a otra pregunta
 * —si corresponde bloquear la apertura de un memo nuevo— y deja fuera a
 * OBSERVADA. Para un líder, una rendición devuelta es justamente alguien
 * que no terminó: tiene que corregirla y volver a presentarla. Dejarla
 * fuera del tablero sería perder de vista al que más seguimiento necesita.
 */
const SIN_CERRAR: EstadoMemo[] = ["ABIERTO", "EN_RENDICION", "OBSERVADA"];

type GastoParaSuma = Pick<Gasto, "estado" | "clase" | "total" | "alertas">;

export interface MemoDeEquipo {
  id: string;
  correlativo: string;
  estado: EstadoMemo;
  monto_autorizado: number;
  fecha_retorno_prev: string | null;
  personas: Array<{ id: string; nombre: string }>;
  gastos: GastoParaSuma[];
}

export interface FilaEquipo {
  usuarioId: string;
  nombre: string;
  /** Memos todavía sin rendir a su nombre. */
  memos: number;
  /** Plata entregada que aún no tiene comprobante detrás. */
  sinRendir: number;
  /** Días desde el retorno del memo más atrasado. 0 si ninguno venció. */
  atrasoDias: number;
  /** Cuántos de sus memos ya pasaron la fecha de retorno. */
  vencidos: number;
}

/**
 * Agrupa por persona los memos que todavía no cerró.
 *
 * Uno ya presentado sale del radar: dejó de ser deuda de esa persona y pasó
 * a ser trabajo del revisor. Perseguir a quien ya cumplió es justamente lo
 * que hoy desgasta la relación con el campo.
 */
export function consolidarEquipo(memos: MemoDeEquipo[], hoy: Date): FilaEquipo[] {
  const porPersona = new Map<string, FilaEquipo>();

  for (const m of memos) {
    if (!SIN_CERRAR.includes(m.estado)) continue;

    const c = consolidar(Number(m.monto_autorizado), m.gastos ?? []);
    const dias = diasDeAtraso(m.fecha_retorno_prev, hoy);

    for (const p of m.personas ?? []) {
      const fila = porPersona.get(p.id) ?? {
        usuarioId: p.id, nombre: p.nombre,
        memos: 0, sinRendir: 0, atrasoDias: 0, vencidos: 0,
      };

      fila.memos += 1;
      // Lo excedido no es deuda de la persona hacia la empresa, es al
      // revés: por eso el saldo negativo no resta aquí.
      fila.sinRendir += Math.max(0, c.saldo);
      fila.atrasoDias = Math.max(fila.atrasoDias, dias);
      if (dias > 0) fila.vencidos += 1;

      porPersona.set(p.id, fila);
    }
  }

  // Primero quien más debe en tiempo; a igual atraso, quien más debe en
  // plata. Es el orden en que conviene llamar por teléfono.
  return [...porPersona.values()].sort(
    (a, b) => b.atrasoDias - a.atrasoDias || b.sinRendir - a.sinRendir
  );
}

/** Días transcurridos desde la fecha de retorno. 0 si aún no vence. */
export function diasDeAtraso(fechaRetorno: string | null, hoy: Date): number {
  if (!fechaRetorno) return 0;
  const retorno = new Date(`${fechaRetorno.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(retorno.getTime())) return 0;

  const dias = Math.floor((hoy.getTime() - retorno.getTime()) / 86_400_000);
  return dias > 0 ? dias : 0;
}

export interface ResumenEquipo {
  personas: number;
  memosAbiertos: number;
  totalSinRendir: number;
  mayorAtraso: number;
  personasVencidas: number;
}

/** Las cifras de cabecera del tablero. */
export function resumirEquipo(filas: FilaEquipo[]): ResumenEquipo {
  return {
    personas: filas.length,
    memosAbiertos: filas.reduce((s, f) => s + f.memos, 0),
    totalSinRendir: filas.reduce((s, f) => s + f.sinRendir, 0),
    mayorAtraso: filas.reduce((m, f) => Math.max(m, f.atrasoDias), 0),
    personasVencidas: filas.filter(f => f.vencidos > 0).length,
  };
}
