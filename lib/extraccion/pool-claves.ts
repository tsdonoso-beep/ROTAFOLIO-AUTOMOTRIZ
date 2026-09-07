// Pool de claves de IA — rotación con enfriamiento
//
// La spec §8.5 pedía mover Gemini al servidor con una clave única de la
// organización. Se implementa con un conjunto de claves en vez de una sola:
// el límite del plan gratuito de Gemini es por clave, así que varias claves
// multiplican el techo diario sin costo. Cuando una se agota, la petición
// sigue con la siguiente en vez de fallarle al usuario en pleno campo.
//
// El estado vive en memoria del proceso. En Vercel cada instancia serverless
// tiene el suyo, de modo que el reparto no es exacto entre instancias — pero
// el enfriamiento sí evita reintentar una clave agotada dentro de la misma.

export interface EstadoClave {
  /** Los últimos caracteres, para poder diagnosticar sin exponer la clave. */
  etiqueta: string;
  usos: number;
  errores: number;
  /** Marca de tiempo hasta la que no se vuelve a intentar. */
  enfriadaHasta: number;
  ultimoError?: string;
}

/** Cuánto se aparta una clave que devolvió 429, en milisegundos. */
const ENFRIAMIENTO_CUOTA_MS = 60 * 60 * 1000; // 1 hora
/** Enfriamiento corto para errores transitorios del servidor de Google. */
const ENFRIAMIENTO_FALLO_MS = 60 * 1000;      // 1 minuto

export class PoolClaves {
  private claves: string[];
  private estado = new Map<string, EstadoClave>();
  private siguiente = 0;

  constructor(claves: string[]) {
    this.claves = claves.filter(Boolean);
    for (const c of this.claves) {
      this.estado.set(c, { etiqueta: etiquetar(c), usos: 0, errores: 0, enfriadaHasta: 0 });
    }
  }

  /**
   * Lee las claves de la variable de entorno. Acepta varias separadas por
   * coma o salto de línea, y admite el nombre en singular por compatibilidad.
   */
  static desdeEntorno(env: Record<string, string | undefined> = process.env): PoolClaves {
    const crudo = env.GEMINI_API_KEYS ?? env.GEMINI_API_KEY ?? "";
    const claves = crudo
      .split(/[,\n]/)
      .map(s => s.trim())
      .filter(Boolean);
    return new PoolClaves([...new Set(claves)]);
  }

  get cantidad(): number {
    return this.claves.length;
  }

  get vacio(): boolean {
    return this.claves.length === 0;
  }

  /** Claves que no están enfriando ahora mismo. */
  disponibles(ahora = Date.now()): string[] {
    return this.claves.filter(c => (this.estado.get(c)?.enfriadaHasta ?? 0) <= ahora);
  }

  /**
   * Devuelve las claves a probar, en orden. Empieza por la siguiente del
   * turno rotatorio para repartir la carga, y deja al final las que están
   * enfriando: si todas fallaron, es preferible reintentar una agotada a no
   * intentar nada.
   */
  ordenDeIntento(ahora = Date.now()): string[] {
    if (this.vacio) return [];

    const rotadas: string[] = [];
    for (let i = 0; i < this.claves.length; i++) {
      rotadas.push(this.claves[(this.siguiente + i) % this.claves.length]);
    }
    this.siguiente = (this.siguiente + 1) % this.claves.length;

    const libres = rotadas.filter(c => (this.estado.get(c)!.enfriadaHasta) <= ahora);
    const enfriando = rotadas.filter(c => (this.estado.get(c)!.enfriadaHasta) > ahora);
    return [...libres, ...enfriando];
  }

  registrarExito(clave: string): void {
    const e = this.estado.get(clave);
    if (!e) return;
    e.usos++;
    e.enfriadaHasta = 0;
    e.ultimoError = undefined;
  }

  /**
   * Aparta la clave. `agotada` distingue el 429 —que dura hasta que Google
   * reponga la cuota— de un fallo pasajero.
   */
  registrarFallo(clave: string, motivo: string, agotada: boolean, ahora = Date.now()): void {
    const e = this.estado.get(clave);
    if (!e) return;
    e.errores++;
    e.ultimoError = motivo;
    e.enfriadaHasta = ahora + (agotada ? ENFRIAMIENTO_CUOTA_MS : ENFRIAMIENTO_FALLO_MS);
  }

  /** Diagnóstico sin exponer las claves. Para una ruta de estado interna. */
  resumen(ahora = Date.now()): Array<EstadoClave & { enfriando: boolean }> {
    return this.claves.map(c => {
      const e = this.estado.get(c)!;
      return { ...e, enfriando: e.enfriadaHasta > ahora };
    });
  }
}

/** `AIzaSyDx...9fKq` → `AIza…9fKq`. Nunca registrar la clave completa. */
function etiquetar(clave: string): string {
  if (clave.length < 12) return "clave-corta";
  return `${clave.slice(0, 4)}…${clave.slice(-4)}`;
}

/**
 * Una única instancia por proceso: si se creara en cada petición, el
 * enfriamiento y el turno rotatorio se perderían entre llamadas.
 */
let compartido: PoolClaves | null = null;

export function poolCompartido(): PoolClaves {
  if (!compartido) compartido = PoolClaves.desdeEntorno();
  return compartido;
}

/** Solo para pruebas: reinicia la instancia compartida. */
export function reiniciarPool(): void {
  compartido = null;
}
