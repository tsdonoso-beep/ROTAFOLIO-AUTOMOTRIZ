import Link from "next/link";
import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { Encabezado } from "@/components/v2/Encabezado";
import { IconoAdministrar, IconoMas } from "@/components/v2/Iconos";
import { BandejaMemos, CAMPOS_MEMO, type FilaMemo } from "@/components/v2/BandejaMemos";
import PanelBorradores, { type Borrador } from "@/components/v2/PanelBorradores";
import type { Autorizacion } from "@/lib/dominio/autorizacion";

export default async function Administrar() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");
  if (!autoriza(solicitante, "crear_memo").ok) redirect("/");

  const sb = await clienteServidor();
  const { data } = await sb
    .from("memos")
    .select(CAMPOS_MEMO)
    .order("creado_en", { ascending: false })
    .limit(60);

  // Los borradores se sacan aparte: un memo sin abrir es invisible para el
  // rendidor, así que si nadie lo mira acá se queda ahí y la persona espera
  // una plata que nunca le llegó a aparecer.
  const { data: crudos } = await sb
    .from("memos")
    .select(`
      id, correlativo, destino, monto_autorizado,
      memo_asignados ( usuarios ( nombre ) ),
      autorizaciones_memo ( id, jefe_id, estado, respuesta, monto, usuarios!autorizaciones_memo_jefe_id_fkey ( nombre ) )
    `)
    .eq("estado", "BORRADOR")
    .order("creado_en", { ascending: false });

  type BorradorCrudo = {
    id: string; correlativo: string; destino: string | null; monto_autorizado: number;
    memo_asignados: Array<{ usuarios: { nombre: string } | null }>;
    autorizaciones_memo: Array<{
      id: string; jefe_id: string; estado: string; respuesta: string | null;
      monto: number; usuarios: { nombre: string } | null;
    }>;
  };

  const borradores: Borrador[] = ((crudos ?? []) as unknown as BorradorCrudo[]).map(m => ({
    id: m.id,
    correlativo: m.correlativo,
    destino: m.destino,
    monto: Number(m.monto_autorizado),
    personas: (m.memo_asignados ?? [])
      .map(a => a.usuarios?.nombre).filter(Boolean).join(", ") || "Sin asignar",
    autorizaciones: (m.autorizaciones_memo ?? []).map((a): Autorizacion => ({
      id: a.id,
      jefeId: a.jefe_id,
      jefeNombre: a.usuarios?.nombre ?? "Jefatura",
      estado: a.estado as Autorizacion["estado"],
      respuesta: a.respuesta,
      monto: Number(a.monto),
    })),
  }));

  return (
    <>
      <Encabezado
        titulo="Administrar memos"
        bajada="El memo se crea aquí, con su centro de costo y monto autorizado. El rendidor solo elige entre los que le asignaste."
        accion={
          <Link href="/administrar/nuevo" className="btn-primary" style={{ textDecoration: "none" }}>
            <IconoMas size={17} />
            Nuevo memo
          </Link>
        }
      />
      <PanelBorradores borradores={borradores} />

      <BandejaMemos
        memos={(data ?? []) as unknown as FilaMemo[]}
        base="/administrar"
        vacio={{
          icono: <IconoAdministrar size={26} />,
          titulo: "Todavía no hay memos",
          texto: "Crea el primero indicando centro de costo, persona asignada y monto autorizado. Aparecerá en «Mis memos» de esa persona.",
        }}
      />
    </>
  );
}
