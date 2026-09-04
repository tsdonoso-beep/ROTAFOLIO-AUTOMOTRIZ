import { GastoItem } from "./types";

const KEY = "rotafolio_gastos";

/**
 * Los gastos se guardan en el navegador para no perderlos al recargar.
 *
 * La imagen (base64) NO se guarda: pesa cientos de KB por comprobante y
 * localStorage tiene un límite de ~5 MB para todo el sitio. Tras recargar,
 * los datos quedan intactos y el enlace de Drive sigue funcionando, pero ya
 * no se puede reprocesar con IA — para eso hay que volver a subir la foto.
 */
type GastoGuardado = Omit<GastoItem, "base64" | "procesando" | "registrando">;

function serializar(items: GastoItem[]): GastoGuardado[] {
  return items.map((i) => {
    const { base64: _b, procesando: _p, registrando: _r, ...resto } = i;
    void _b; void _p; void _r;
    return resto;
  });
}

export function getGastos(): GastoItem[] {
  if (typeof window === "undefined") return [];
  try {
    const lista: GastoGuardado[] = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return lista.map((g) => ({
      ...g,
      base64: "",
      procesando: false,
      registrando: false,
    }));
  } catch {
    return [];
  }
}

export function saveGastos(items: GastoItem[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(serializar(items)));
  } catch {
    // Cuota llena: preferimos seguir funcionando en memoria antes que romper
    // la sesión. Los gastos ya registrados están a salvo en la planilla.
    console.warn("No se pudieron guardar los gastos localmente (cuota llena).");
  }
}

export const gastosDeProyecto = (items: GastoItem[], proyectoId: string) =>
  items.filter((i) => i.proyecto_id === proyectoId);
