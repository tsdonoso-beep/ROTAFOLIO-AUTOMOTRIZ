// Navegación según rol — SPEC §6
//
// Cada sección declara qué acción de la matriz de permisos la habilita, de
// modo que el menú no puede desalinearse de lo que el servidor autoriza:
// ambos leen la misma fuente.

import type { Rol } from "./tipos.ts";
import { puede, type Accion } from "./permisos.ts";

export interface Seccion {
  clave: string;
  etiqueta: string;
  ruta: string;
  /** Acción que debe estar permitida para ver la sección. */
  requiere: Accion;
  resumen: string;
}

export const SECCIONES: Seccion[] = [
  {
    clave: "memos",
    etiqueta: "Mis memos",
    ruta: "/memos",
    requiere: "ver_memos_propios",
    resumen: "Tus rendiciones abiertas y los comprobantes que llevas cargados",
  },
  {
    clave: "solicitudes",
    etiqueta: "Pedidos",
    ruta: "/solicitudes",
    requiere: "solicitar_memo",
    resumen: "Pedir un memo y seguir el visto bueno de la jefatura",
  },
  {
    clave: "administrar",
    etiqueta: "Administrar",
    ruta: "/administrar",
    requiere: "crear_memo",
    resumen: "Crear memos, asignar personas y definir el monto autorizado",
  },
  {
    clave: "revisar",
    etiqueta: "Revisar",
    ruta: "/revisar",
    requiere: "aprobar_rendicion",
    resumen: "Rendiciones presentadas, con sus alertas y desviaciones",
  },
  {
    clave: "contabilidad",
    etiqueta: "Contabilidad",
    ruta: "/contabilidad",
    requiere: "marcar_contabilizado",
    resumen: "Rendiciones aprobadas, exportación y marcado de contabilizado",
  },
  {
    clave: "liquidaciones",
    etiqueta: "Liquidaciones",
    ruta: "/liquidaciones",
    requiere: "exportar",
    resumen: "Saldos por persona a lo largo de todos sus memos, para pasar a pago",
  },
  {
    clave: "caja",
    etiqueta: "Caja chica",
    ruta: "/caja",
    requiere: "ver_memos_propios",
    resumen: "Los fondos, su saldo y los ciclos con que se van reponiendo",
  },
  {
    clave: "movilidad",
    etiqueta: "Movilidad",
    ruta: "/movilidad",
    // La llena quien se desplaza, así que se rige por el mismo permiso que
    // capturar un gasto: es un gasto, solo que con su propio formulario.
    requiere: "capturar_gasto",
    resumen: "Planillas del talonario, con una fila por desplazamiento y la firma de la jefatura",
  },
  {
    clave: "tablero",
    etiqueta: "Firmas",
    ruta: "/tablero",
    requiere: "autorizar_apertura_con_pendientes",
    resumen: "Lo que espera tu firma, y quién de tu equipo tiene memos sin cerrar",
  },
  {
    clave: "sistema",
    etiqueta: "Sistema",
    ruta: "/sistema",
    requiere: "editar_catalogos",
    resumen: "Usuarios, catálogos, parámetros y bitácora de eventos",
  },
];

export function seccionesDe(roles: Rol[]): Seccion[] {
  return SECCIONES.filter(s => puede(roles, s.requiere));
}

/**
 * Sección donde aterriza cada persona al entrar. Un rendidor puro va directo
 * a lo suyo; alguien con roles administrativos suele venir a gestionar.
 */
export function seccionInicial(roles: Rol[]): Seccion | null {
  const visibles = seccionesDe(roles);
  if (!visibles.length) return null;

  const soloRendidor = roles.length === 1 && roles[0] === "RENDIDOR";
  if (soloRendidor) return visibles.find(s => s.clave === "memos") ?? visibles[0];

  return visibles[0];
}

export const NOMBRE_ROL: Record<Rol, string> = {
  RENDIDOR: "Rendidor",
  ADMIN_MEMOS: "Administrador de memos",
  REVISOR_COSTOS: "Revisor de costos",
  CONTABILIDAD: "Contabilidad",
  JEFATURA: "Jefatura",
  ADMIN_SISTEMA: "Administrador del sistema",
};
