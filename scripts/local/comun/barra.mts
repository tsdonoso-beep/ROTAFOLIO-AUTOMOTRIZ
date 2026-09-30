// Barra de progreso fija en la última línea de la terminal; los logs siguen saliendo arriba, igual que siempre.
//
// Sin dependencias: antes de cada log se borra la barra, se escribe el log y
// se vuelve a pintar la barra debajo. Si la salida no es una terminal (CI, un
// archivo, un pipe), no se pinta nada y los logs quedan exactamente como antes.

/**
 * «hechos» cuenta lo TERMINADO de punta a punta: guardado en la base, o
 * cerrado sin nada que guardar (no existe, agotado, falló en Drive). La
 * corrida del 30/09/2026 mostró por qué: SUNAT terminó en 5 min, pero Drive
 * (~80/min) tardó 25 min más, y una barra que contaba solo las consultas
 * marcaba 100% con una ETA que no paraba de subir.
 */
export interface Progreso {
  hechos: number;
  total: number;
  ok: number;              // guardados en la base
  consultados: number;     // ya bajados de SUNAT (van por delante de «hechos»)
  enEspera: number;        // reintentos esperando su turno
  enVuelo: number;
  subidas: number;         // PDF + Drive pendientes
  inicio: number;          // ms epoch
}

export function duracion(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}h${String(m).padStart(2, "0")}m` : m ? `${m}m${String(r).padStart(2, "0")}s` : `${r}s`;
}

/** El texto de la barra, para un ancho de terminal dado. Pura: la prueban los tests. */
export function textoBarra(p: Progreso, ancho: number, ahora = Date.now()): string {
  const frac = p.total ? Math.min(1, p.hechos / p.total) : 0;
  const trans = ahora - p.inicio;
  const ritmo = trans > 0 ? p.hechos / (trans / 60000) : 0;               // por minuto
  const eta = p.hechos > 0 && ritmo > 0 ? ((p.total - p.hechos) / ritmo) * 60000 : NaN;
  const etapa = p.consultados >= p.total ? "SUNAT listo" : `SUNAT ${p.consultados}/${p.total}`;
  const cola = `${(frac * 100).toFixed(0).padStart(3)}% ${p.hechos}/${p.total} guardados · ${etapa} · ${p.subidas} en PDF/Drive · ${p.enEspera} por reintentar · ${ritmo.toFixed(0)}/min · ETA ${duracion(eta)} · ${duracion(trans)}`;
  const largo = Math.max(10, Math.min(40, ancho - cola.length - 4));
  const llenos = Math.round(frac * largo);
  return `[${"█".repeat(llenos)}${"░".repeat(largo - llenos)}] ${cola}`.slice(0, Math.max(20, ancho - 1));
}

export class Barra {
  private activa: boolean;
  private ultimo = "";
  private leer: () => Progreso;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(leer: () => Progreso) {
    this.leer = leer;
    this.activa = !!process.stdout.isTTY && process.env.BARRA !== "0";
  }

  private pintar() {
    if (!this.activa) return;
    this.ultimo = textoBarra(this.leer(), process.stdout.columns || 100);
    process.stdout.write(`\r\x1b[2K${this.ultimo}`);
  }

  /** Escribe una línea de log por encima de la barra. */
  escribir(linea: string) {
    if (!this.activa) { console.log(linea); return; }
    process.stdout.write(`\r\x1b[2K${linea}\n`);
    this.pintar();
  }

  iniciar() { this.pintar(); this.timer = setInterval(() => this.pintar(), 1000); }

  terminar() {
    if (this.timer) clearInterval(this.timer);
    if (this.activa) { this.pintar(); process.stdout.write("\n"); }
    this.activa = false;
  }
}
