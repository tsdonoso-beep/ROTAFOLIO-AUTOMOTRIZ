import { NextResponse } from "next/server";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { generarMemo, nombreDeArchivo } from "@/lib/word/memo";

/**
 * Descarga el memo en Word.
 *
 * El documento sale de la base, no de copiar el Word anterior. Y el nombre
 * del archivo es el que el MemoTracker lee: en 341 de 422 memos el asunto
 * del correo ni siquiera trae el número, así que si el nombre no calza, el
 * memo entra a su hoja sin número y alguien lo corrige a mano.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const solicitante = await solicitanteActual();
  if (!solicitante) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  }
  if (!autoriza(solicitante, "crear_memo").ok) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const sb = await clienteServidor();

  const { data: memo } = await sb
    .from("memos")
    .select(`
      id, correlativo, tipo, destino, fecha_salida, creado_en,
      centros_costo ( codigo, nombre, abreviatura ),
      empresas ( razon_social ),
      creador:usuarios!memos_creado_por_fkey ( nombre, cargo ),
      memo_asignados ( monto, fecha_desde, fecha_hasta, usuarios ( nombre, dni, cargo ) )
    `)
    .eq("id", id)
    .single();

  if (!memo) {
    return NextResponse.json({ error: "El memo no existe o no tienes acceso." }, { status: 404 });
  }

  const centro = memo.centros_costo as unknown as
    { codigo: string; nombre: string; abreviatura: string | null } | null;
  const empresa = memo.empresas as unknown as { razon_social: string } | null;
  const creador = memo.creador as unknown as { nombre: string; cargo: string | null } | null;

  const personas = ((memo.memo_asignados ?? []) as unknown as Array<{
    monto: number | null; fecha_desde: string | null; fecha_hasta: string | null;
    usuarios: { nombre: string; dni: string; cargo: string | null } | null;
  }>)
    .filter(a => a.usuarios)
    .map(a => ({
      nombre: a.usuarios!.nombre,
      dni: a.usuarios!.dni,
      cargo: a.usuarios!.cargo,
      monto: Number(a.monto ?? 0),
      fechaDesde: a.fecha_desde,
      fechaHasta: a.fecha_hasta,
    }))
    // En el orden del anexo real: primero los montos mayores.
    .sort((x, y) => y.monto - x.monto || x.nombre.localeCompare(y.nombre, "es"));

  if (personas.length === 0) {
    return NextResponse.json(
      { error: "Este memo no tiene anexo, así que no hay nada que generar." },
      { status: 400 }
    );
  }

  // El número como se nombra, sin el prefijo de empresa del correlativo
  // interno: el papel dice «594-2026», no «INROPRIN-2026-VIA-00594».
  const numero = memo.correlativo.replace(/^.*?-(\d{4})-[A-Z]{3}-0*(\d+)$/, "$2-$1");

  const concepto = {
    VIATICOS: "Gastos de viáticos",
    HOSPEDAJE: "Gastos de hospedaje",
    PASAJES: "Gastos de pasajes",
    CAJA_CHICA: "Caja chica",
    REEMBOLSO: "Reembolso de gastos",
    OTRO: "Gastos",
  }[memo.tipo as string] ?? "Gastos";

  const docx = generarMemo({
    numero,
    concepto,
    // La abreviatura es como Control de Gestión nombra el proyecto en sus
    // reportes; el código no se reconoce de un vistazo.
    area: centro?.abreviatura ?? centro?.nombre ?? "",
    empresa: empresa?.razon_social ?? "",
    destino: memo.destino,
    firmante: creador?.nombre ?? "",
    cargoFirmante: creador?.cargo ?? null,
    dirigidoA: "Gerencia de Administración y Finanzas",
    fecha: (memo.fecha_salida ?? memo.creado_en ?? "").slice(0, 10)
      .split("-").reverse().join("/"),
    personas,
  });

  const nombre = nombreDeArchivo({
    numero, concepto, area: centro?.abreviatura ?? centro?.nombre ?? "",
  });

  return new NextResponse(docx as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      // El nombre lleva tildes, así que va también en la forma codificada:
      // sin filename*, algunos navegadores lo guardan como «_».
      "Content-Disposition":
        `attachment; filename="${nombre.replace(/[^\x20-\x7E]/g, "_")}.docx"; `
        + `filename*=UTF-8''${encodeURIComponent(nombre + ".docx")}`,
    },
  });
}
