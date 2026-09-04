import { GastoItem, Proyecto, Usuario } from "./types";

/**
 * Envía un gasto a la planilla de registro. La planilla es append-only:
 * cada llamada agrega una fila nueva, nunca modifica las anteriores.
 */
export async function registrarEnPlanilla(
  item: GastoItem,
  proyecto: Proyecto,
  usuario: Usuario
): Promise<{ fecha: string }> {
  const e = item.extraido;

  const res = await fetch("/api/sheet-append", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id_gasto: item.id,
      usuario_nombre: usuario.nombre,
      proyecto_nombre: proyecto.nombre,
      centro_costos: proyecto.centro_costos,
      caja: proyecto.caja,
      numero_solicitud: item.numero_solicitud,
      fecha_solicitud: item.fecha_solicitud,
      proveedor: e?.proveedor ?? "",
      tipo_comprobante: e?.tipo_comprobante ?? "",
      numero_comprobante: e?.numero_comprobante ?? "",
      fecha_comprobante: e?.fecha_comprobante ?? "",
      moneda: e?.moneda ?? "PEN",
      subtotal: e?.subtotal ?? 0,
      igv: e?.igv ?? 0,
      total: e?.monto_total ?? 0,
      forma_pago: e?.forma_pago ?? "",
      detalle: e?.detalle ?? "",
      empresa: item.empresa,
      responsable: item.responsable,
      area_proyecto: item.area_proyecto,
      solicitante: item.solicitante,
      motivo: item.motivo,
      estado: item.estado,
      drive_url: item.drive_url ?? "",
    }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Error al registrar en la planilla");
  return { fecha: json.fecha };
}
