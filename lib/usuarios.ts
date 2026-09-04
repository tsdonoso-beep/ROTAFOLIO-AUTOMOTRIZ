import { Usuario } from "./types";

/**
 * Identificación simple para el MVP.
 *
 * ATENCIÓN: esto NO es autenticación. El PIN viaja en el código del
 * navegador y cualquiera puede leerlo con las herramientas de desarrollo.
 * Sirve para saber QUIÉN registró cada gasto (atribución), no para impedir
 * el acceso. Si en el futuro se necesita seguridad real, hay que mover la
 * verificación al servidor con sesiones firmadas.
 */
export const USUARIOS: Usuario[] = [
  { id: "tdonoso", nombre: "Tomás Donoso", iniciales: "TD" },
  { id: "cgarciarosell", nombre: "Camila García Rosell", iniciales: "CG" },
];

const PIN = "2306";
const KEY = "rotafolio_sesion";

export function verificarPin(pin: string): boolean {
  return pin.trim() === PIN;
}

export function getUsuario(id: string): Usuario | undefined {
  return USUARIOS.find((u) => u.id === id);
}

export function getSesion(): Usuario | null {
  if (typeof window === "undefined") return null;
  try {
    const id = localStorage.getItem(KEY);
    return id ? getUsuario(id) ?? null : null;
  } catch {
    return null;
  }
}

export function iniciarSesion(u: Usuario): void {
  localStorage.setItem(KEY, u.id);
}

export function cerrarSesion(): void {
  localStorage.removeItem(KEY);
}
