/**
 * Colas y semáforos para hacer varias cosas a la vez sin pasarse.
 *
 * En Node no hacen falta hilos para esto: bajar archivos es espera de red
 * (miles pueden estar «en vuelo» desde un solo hilo) y el OCR corre en
 * procesos aparte (`tesseract`, `pdftoppm`), uno por núcleo. Lo que sí hace
 * falta es REPARTIR bien: una cola de trabajo de la que tiran varios
 * trabajadores, y un tope distinto para cada recurso (la red y la CPU).
 */

/** Deja pasar como mucho `limite` a la vez; los demás esperan en fila. */
export class Semaforo {
  private libres: number;
  private fila: Array<() => void> = [];
  constructor(limite: number) { this.libres = Math.max(1, Math.floor(limite)); }

  async usar<T>(fn: () => Promise<T>): Promise<T> {
    if (this.libres > 0) this.libres--;
    else await new Promise<void>(r => this.fila.push(r));
    try { return await fn(); }
    finally {
      const siguiente = this.fila.shift();
      if (siguiente) siguiente(); else this.libres++;
    }
  }
}

/**
 * Procesa una cola que crece mientras se trabaja (una carpeta trae
 * subcarpetas): `trabajadores` tiran de ella sin esperar a que termine un
 * «nivel». Cada vez, `tomar` dice cuántos elementos agarra un trabajador de
 * una vez (para leer varias carpetas en una sola consulta). Termina cuando
 * la cola está vacía y nadie está trabajando. Un error de `fn` no detiene a
 * los demás: va a `alFallar` con los elementos que fallaron.
 */
export async function procesarCola<T>(p: {
  inicial: T[];
  trabajadores: () => number;
  tomar?: () => number;
  fn: (lote: T[]) => Promise<T[]>;
  alFallar: (lote: T[], error: unknown) => T[] | void;
}): Promise<void> {
  const cola = [...p.inicial];
  let activos = 0;
  await new Promise<void>((terminar, fallar) => {
    const lanzar = () => {
      if (!cola.length && activos === 0) { terminar(); return; }
      while (cola.length && activos < Math.max(1, p.trabajadores())) {
        const lote = cola.splice(0, Math.max(1, p.tomar?.() ?? 1));
        activos++;
        p.fn(lote)
          .then(nuevos => { cola.push(...nuevos); })
          .catch(e => { const devueltos = p.alFallar(lote, e); if (devueltos) cola.push(...devueltos); })
          .then(() => { activos--; lanzar(); })
          .catch(fallar);
      }
    };
    lanzar();
  });
}
