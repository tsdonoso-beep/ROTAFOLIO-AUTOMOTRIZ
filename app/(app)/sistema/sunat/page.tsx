import Link from "next/link";
import { redirect } from "next/navigation";
import { solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { Encabezado, Tarjeta } from "@/components/v2/Encabezado";
import { IconoAtras } from "@/components/v2/Iconos";
import PanelSunat from "@/components/v2/PanelSunat";
import CruceSunat from "@/components/v2/CruceSunat";
import { estadoDeCredenciales } from "@/app/acciones/sunat";
import BitacoraSunat from "@/components/v2/BitacoraSunat";
import { ultimasConsultas, ultimosCambios } from "@/lib/datos/consultas-sunat";
import CambiosSunat from "@/components/v2/CambiosSunat";
import HistoricoSunat from "@/components/v2/HistoricoSunat";
import { periodosGuardados } from "@/app/acciones/historico-sunat";

export default async function CredencialesSunat() {
  const solicitante = await solicitanteActual();
  if (!solicitante) redirect("/ingresar");
  if (!autoriza(solicitante, "editar_catalogos").ok) redirect("/");

  const [empresas, consultas, periodos, cambios] = await Promise.all([
    estadoDeCredenciales(),
    ultimasConsultas(),
    periodosGuardados(),
    ultimosCambios(),
  ]);

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

      {/* El cruce solo se ofrece para las empresas que ya tienen sus cuatro
          variables: sin credenciales el botón llevaría a un error seguro. */}
      {empresas.filter(e => e.variables.every(v => v.puesta)).map(e => (
        <div key={e.empresa} style={{ marginTop: 16 }}>
          <CruceSunat empresa={e.empresa} />
        </div>
      ))}

      <div style={{ marginTop: 16 }}>
        <CambiosSunat cambios={cambios} />
      </div>

      <div style={{ marginTop: 16 }}>
        <HistoricoSunat periodos={periodos} />
      </div>

      <div style={{ marginTop: 16 }}>
        <BitacoraSunat consultas={consultas} />
      </div>

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
