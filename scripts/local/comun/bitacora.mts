// Bitácora de las corridas locales: consola legible + archivos JSONL para diagnosticar después.
//
// logs/<prefijo>-<fecha>/
//   eventos.jsonl   todo lo que sale por consola, con datos extra
//   http.jsonl      cada respuesta HTTP con estado >= 400 (host, ruta, estado, cuerpo crudo)
//   …               lo que cada script agregue con jsonl()

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type Nivel = "info" | "aviso" | "error";

/** Por dónde salen las líneas de consola: la barra de progreso la cambia para escribir por encima de ella. */
let salida: (linea: string) => void = linea => console.log(linea);
export function usarSalida(fn: (linea: string) => void): void {
  salida = fn;
}

export interface Bitacora {
  dir: string;
  corrida: string;
  log(nivel: Nivel, quien: string, msg: string, extra?: Record<string, unknown>): void;
  jsonl(archivo: string, dato: unknown): void;
  /** Cuenta una respuesta HTTP por host + ruta normalizada + estado, y guarda cruda la que falló. */
  http(r: RespuestaHttp): void;
  conteoHttp(): Record<string, number>;
}

export interface RespuestaHttp {
  metodo: string;
  url: string;
  status: number;
  cuerpo?: string;
  quien?: string;
  ms?: number;
}

export function crearBitacora(prefijo: string): Bitacora {
  const corrida = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = join(process.cwd(), "logs", `${prefijo}-${corrida}`);
  mkdirSync(join(dir, "errores"), { recursive: true });
  const conteo = new Map<string, number>();

  const jsonl = (archivo: string, dato: unknown) => {
    try {
      appendFileSync(join(dir, archivo), JSON.stringify(dato) + "\n");
    } catch {
      /* la bitácora nunca tumba la corrida */
    }
  };

  return {
    dir,
    corrida,
    jsonl,
    log(nivel, quien, msg, extra) {
      const t = new Date();
      const marca = nivel === "error" ? "✗" : nivel === "aviso" ? "⚠" : "·";
      salida(`${t.toTimeString().slice(0, 8)} ${marca} [${quien}] ${msg}`);
      jsonl("eventos.jsonl", { t: t.toISOString(), nivel, quien, msg, ...extra });
    },
    http(r) {
      const k = claveHttp(r.metodo, r.url, r.status);
      conteo.set(k, (conteo.get(k) ?? 0) + 1);
      if (r.status >= 400) jsonl("http.jsonl", { t: new Date().toISOString(), ...r, cuerpo: r.cuerpo?.slice(0, 4000) });
    },
    conteoHttp: () => Object.fromEntries([...conteo.entries()].sort((a, b) => b[1] - a[1])),
  };
}

/**
 * «GET 500 api-cpe.sunat.gob.pe /v1/…/comprobantes/:id» — la ruta sin los
 * datos variables (RUC-tipo-serie-número, números largos), para que los
 * conteos agrupen por servicio y no por comprobante.
 */
export function claveHttp(metodo: string, url: string, status: number): string {
  let host = "?",
    ruta = url;
  try {
    const u = new URL(url);
    host = u.host;
    ruta = u.pathname;
  } catch {
    /* url rara: se deja tal cual */
  }
  ruta = ruta
    .replace(/\/\d{11}-\w{2}-\w{4}-\d+-\d(?=\/|$)/g, "/:id")
    .replace(/\/\d{11}-\w{2}-\d(?=\/|$)/g, "/:lista")
    .replace(/\/\d{6,}(?=\/|$)/g, "/:n");
  return `${metodo} ${status} ${host} ${ruta}`;
}

/** El error tal cual: nombre, mensaje completo y pila. */
export function crudo(e: unknown): { nombre: string; mensaje: string; pila?: string } {
  if (e instanceof Error) return { nombre: e.name, mensaje: e.message, pila: e.stack };
  if (e && typeof e === "object") return { nombre: "objeto", mensaje: JSON.stringify(e) };
  return { nombre: typeof e, mensaje: String(e) };
}

export const primeraLinea = (e: unknown) => crudo(e).mensaje.split("\n")[0].slice(0, 200);

export const dormir = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Que nada se muera en silencio: toda promesa o excepción sin manejar queda en la bitácora. */
/**
 * Que nada se muera en silencio: toda promesa o excepción sin manejar queda en
 * la bitácora — y el proceso TERMINA con código 1. Escuchar estos eventos le
 * quita a Node su salida automática: sin el exit, un error antes de arrancar
 * (p. ej. «el login mostró un captcha») dejaba el proceso vivo con el
 * navegador abierto, colgado hasta el tope del workflow (GitHub, 30/09/2026).
 */
export function vigilarProceso(b: Bitacora): void {
  const morir = (que: string, e: unknown) => {
    b.log("error", "proceso", `${que} sin manejar: ${primeraLinea(e)}`, { error: crudo(e) });
    process.exit(1);
  };
  process.on("unhandledRejection", e => morir("promesa", e));
  process.on("uncaughtException", e => morir("excepción", e));
}
