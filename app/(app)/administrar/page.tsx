import Link from "next/link";
import { redirect } from "next/navigation";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { Encabezado } from "@/components/v2/Encabezado";
import { IconoAdministrar, IconoMas } from "@/components/v2/Iconos";
import { BandejaMemos, CAMPOS_MEMO, type FilaMemo } from "@/components/v2/BandejaMemos";

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
