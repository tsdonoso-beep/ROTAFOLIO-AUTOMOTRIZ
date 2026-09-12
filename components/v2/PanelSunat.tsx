"use client";
import { useState, useTransition } from "react";
import { Aviso, Tarjeta } from "./Encabezado";
import { IconoAlerta, IconoCheck, IconoLlave } from "./Iconos";
import { probarCredenciales, type EstadoSunat } from "@/app/acciones/sunat";

/**
 * Estado de las credenciales de SUNAT, por empresa.
 *
 * Que las cuatro variables estén puestas no dice nada sobre si sirven: hay
 * que pedirle un token a SUNAT para saberlo. Por eso hay un botón y no un
 * semáforo automático —y porque pedir el token en cada carga de la página
 * sería llamar a SUNAT sin motivo.
 */
export default function PanelSunat({ empresas }: { empresas: EstadoSunat[] }) {
  if (!empresas.length) {
    return <Tarjeta><p style={{ fontSize: 12.5, color: "var(--text3)" }}>
      No hay empresas activas registradas.
    </p></Tarjeta>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {empresas.map(e => <Empresa key={e.empresa} inicial={e} />)}
    </div>
  );
}

function Empresa({ inicial }: { inicial: EstadoSunat }) {
  const [pendiente, iniciar] = useTransition();
  const [res, setRes] = useState(inicial.resultado);

  const completas = inicial.variables.every(v => v.puesta);
  const faltantes = inicial.variables.filter(v => !v.puesta);

  const probar = () => iniciar(async () => setRes(await probarCredenciales(inicial.empresa)));

  return (
    <Tarjeta>
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 12,
      }}>
        <div>
          <span className="font-display" style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)" }}>
            {inicial.empresa}
          </span>
          <span className="mono" style={{ fontSize: 11.5, color: "var(--text3)", marginLeft: 9 }}>
            {inicial.ruc}
          </span>
        </div>
        <span className="badge" style={
          completas
            ? { background: "var(--success-bg)", color: "var(--success)" }
            : { background: "var(--warn-bg)", color: "var(--warn)" }
        }>
          {completas ? "4 de 4 variables" : `faltan ${faltantes.length} de 4`}
        </span>
      </div>

      {!completas && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 11.5, color: "var(--text3)", marginBottom: 6, lineHeight: 1.5 }}>
            Agrégalas en Vercel · Settings · Environment Variables, sin el prefijo
            NEXT_PUBLIC, y vuelve a desplegar:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {faltantes.map(v => (
              <span key={v.nombre} className="mono" style={{ fontSize: 11.5, color: "var(--warn)" }}>
                {v.nombre}
              </span>
            ))}
          </div>
        </div>
      )}

      {res.tipo === "ok" && (
        <div style={{ marginBottom: 12 }}>
          <Aviso tono="ok" icono={<IconoCheck size={16} />}>
            SUNAT dio token. Sirve por {res.segundos} segundos más. Las credenciales
            de <span className="mono">{res.usuario}</span> funcionan.
          </Aviso>
        </div>
      )}

      {(res.tipo === "error" || res.tipo === "faltan") && (
        <div style={{ marginBottom: 12 }}>
          <Aviso tono="error" icono={<IconoAlerta size={16} />}>
            {res.motivo}
          </Aviso>
        </div>
      )}

      <button className="btn-ghost" onClick={probar} disabled={pendiente || !completas}
        style={{ width: "100%", justifyContent: "center" }}>
        <IconoLlave size={15} />
        {pendiente ? "Preguntando a SUNAT…" : "Probar la conexión"}
      </button>
      <p style={{ marginTop: 7, fontSize: 11, color: "var(--text3)", lineHeight: 1.45 }}>
        Solo pide un token para comprobar las credenciales. No descarga nada ni
        encola ningún proceso en SUNAT, así que se puede repetir sin costo.
      </p>
    </Tarjeta>
  );
}
