import Link from "next/link";
import { redirect } from "next/navigation";
import { solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { Encabezado, Tarjeta } from "@/components/v2/Encabezado";
import { IconoAtras } from "@/components/v2/Iconos";
import PanelSunat from "@/components/v2/PanelSunat";
import { estadoDeCredenciales } from "@/app/acciones/sunat";

export default async function CredencialesSunat() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");
  if (!autoriza(solicitante, "editar_catalogos").ok) redirect("/");

  const empresas = await estadoDeCredenciales();

  return (
    <>
      <Link href="/sistema" className="hover-atras" style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 13, color: "var(--text2)", textDecoration: "none", marginBottom: 16,
      }}>
        <IconoAtras size={15} />
        Sistema
      </Link>

      <Encabezado
        titulo="Credenciales de SUNAT"
        bajada="Las credenciales del SIRE son por RUC: cada empresa del grupo y cada consorcio necesita las suyas. Viven en el entorno del servidor, nunca en la base de datos ni en el repositorio."
      />

      <PanelSunat empresas={empresas} />

      <Tarjeta style={{ marginTop: 16 }}>
        <p className="rotulo" style={{ marginBottom: 8 }}>Qué resuelve esto y qué no</p>
        <p style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.6 }}>
          El registro de compras trae los comprobantes que los proveedores
          declararon <strong>contra el RUC de la empresa</strong>. Sirve para
          confirmar facturas. Una boleta que el técnico pidió a su nombre en una
          bodega de provincia, o un Yape, no aparece ahí —no porque falte, sino
          porque nunca se declaró contra la empresa—. Para esos casos siguen
          valiendo las alertas de la app.
        </p>
      </Tarjeta>
    </>
  );
}
