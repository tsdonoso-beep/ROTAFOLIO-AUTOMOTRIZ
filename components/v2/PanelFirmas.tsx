"use client";
import Link from "next/link";
import { Tarjeta, soles } from "./Encabezado";
import { IconoCheck } from "./Iconos";
import PanelSolicitud from "./PanelSolicitud";
import { ETIQUETA_SOLICITUD, type EstadoSolicitud } from "@/lib/dominio/solicitud";

interface Pedido {
  id: string; tipo: string; estado: EstadoSolicitud;
  motivo: string; destino: string | null; monto: number | null;
  desde: string | null; hasta: string | null; respuesta: string | null;
  memoId: string | null;
  solicitanteId: string; solicitanteNombre: string;
  jefeId: string | null; jefeNombre: string | null;
  personas: Array<{ id: string; nombre: string; monto: number | null }>;
}

interface Planilla {
  id: string; numero: string; periodo: string | null;
  dueno: string; desplazamientos: number; total: number;
}

/**
 * Lo que espera mi firma.
 *
 * La jefatura firma tres cosas distintas —un pedido de memo, la casilla
 * AUTORIZADO de una planilla de movilidad, y la apertura de un memo para
 * quien no rindió el anterior— y las tres le están frenando el trabajo a
 * alguien. Tenerlas en tres pantallas era tenerlas en ninguna: se firmaba lo
 * que alguien se acordaba de recordar por WhatsApp.
 *
 * Va primero en el tablero por eso mismo: es lo único de esa pantalla donde
 * hay otra persona esperando.
 */
export default function PanelFirmas({ yo, puedeEmitir, pedidos, planillas }: {
  yo: string;
  puedeEmitir: boolean;
  pedidos: Pedido[];
  planillas: Planilla[];
}) {
  const total = pedidos.length + planillas.length;

  if (total === 0) {
    return (
      <div style={{ marginBottom: 18 }}>
        <Tarjeta padding={15}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <span style={{ color: "var(--accent)", display: "flex" }}>
              <IconoCheck size={18} />
            </span>
            <p style={{ fontSize: 13, color: "var(--text2)" }}>
              Nada espera tu firma. Nadie está detenido por ti.
            </p>
          </div>
        </Tarjeta>
      </div>
    );
  }

  return (
    <section style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 11 }}>
        <h2 className="font-display" style={{
          fontSize: 17, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.025em",
        }}>
          Esperan tu firma
        </h2>
        <span className="badge badge-warn">{total}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {pedidos.map(p => (
          <PanelSolicitud key={p.id} solicitud={p} yo={yo} puedeEmitir={puedeEmitir}
            tono={{ fondo: "var(--warn-bg, rgba(217,119,6,0.08))", texto: "var(--warn)" }}
            etiqueta={ETIQUETA_SOLICITUD[p.estado]} />
        ))}

        {planillas.map(p => (
          <Link key={p.id} href={`/movilidad/${p.id}`} style={{ textDecoration: "none" }}>
            <Tarjeta padding={14}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="badge badge-neutro">Planilla de movilidad</span>
                  <p className="font-display" style={{
                    fontSize: 13.5, fontWeight: 700, color: "var(--text)",
                    marginTop: 8, letterSpacing: "-0.01em",
                  }}>
                    N° <span className="mono">{p.numero}</span> · {p.dueno}
                  </p>
                  <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 3 }}>
                    {p.desplazamientos} desplazamiento{p.desplazamientos === 1 ? "" : "s"}
                    {p.periodo && ` · ${p.periodo}`}
                  </p>
                </div>
                <span className="cifra cifra-m">{soles(p.total)}</span>
              </div>
            </Tarjeta>
          </Link>
        ))}
      </div>
    </section>
  );
}
