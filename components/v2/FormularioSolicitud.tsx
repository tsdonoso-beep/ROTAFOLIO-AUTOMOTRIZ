"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Aviso, Tarjeta, soles } from "./Encabezado";
import { IconoAlerta, IconoAtras } from "./Iconos";
import { crearSolicitud } from "@/app/acciones/solicitudes";
import { revisarAnexo } from "@/lib/dominio/anexo";
import SelectorDePersonas from "./SelectorDePersonas";

interface Props {
  centros: Array<{ id: string; codigo: string; nombre: string }>;
  personas: Array<{
    id: string; nombre: string; dni: string;
    cargo?: string | null; area?: string | null;
  }>;
  yo: string;
  jefeNombre: string | null;
}

const TIPOS = [
  { valor: "HOSPEDAJE", etiqueta: "Hospedaje" },
  { valor: "VIATICOS", etiqueta: "Viáticos" },
  { valor: "CAJA_CHICA", etiqueta: "Caja chica" },
  { valor: "PASAJES", etiqueta: "Pasajes" },
  { valor: "REEMBOLSO", etiqueta: "Reembolso" },
  { valor: "OTRO", etiqueta: "Otro" },
];

interface Fila { monto: string; desde: string; hasta: string }

const hoy = () => new Date().toISOString().slice(0, 10);
const enDias = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const porOmision = (): Fila => ({ monto: "", desde: hoy(), hasta: enDias(3) });

/**
 * Pedir un memo.
 *
 * Es el mismo formulario que el del memo, con dos diferencias: lo puede usar
 * cualquiera, y lo que sale no es un memo sino un pedido esperando una firma.
 */
export default function FormularioSolicitud({ centros, personas, yo, jefeNombre }: Props) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState("");

  const [tipo, setTipo] = useState("VIATICOS");
  const [centro, setCentro] = useState(centros[0]?.id ?? "");
  const [motivo, setMotivo] = useState("");
  const [destino, setDestino] = useState("");
  // Casi siempre uno pide para sí mismo, así que se arranca ahí.
  const [elegidas, setElegidas] = useState<string[]>([yo]);
  const [filas, setFilas] = useState<Record<string, Fila>>({});

  const deAnexo = elegidas.map(id => {
    const f = filas[id] ?? porOmision();
    return {
      usuarioId: id,
      nombre: personas.find(p => p.id === id)?.nombre ?? "esa persona",
      monto: f.monto === "" ? null : Number(f.monto),
      fechaDesde: f.desde || null,
      fechaHasta: f.hasta || null,
    };
  });
  const anexo = revisarAnexo(deAnexo);
  const listo = Boolean(centro) && motivo.trim().length > 0 && anexo.reparos.length === 0;

  const editar = (id: string, campo: keyof Fila, valor: string) =>
    setFilas(f => ({ ...f, [id]: { ...(f[id] ?? porOmision()), [campo]: valor } }));

  const enviar = () => {
    setError("");
    iniciar(async () => {
      const r = await crearSolicitud({
        tipo, centro_costo_id: centro, motivo, destino,
        personas: deAnexo.map(f => ({
          usuario_id: f.usuarioId, nombre: f.nombre, monto: f.monto,
          fecha_desde: f.fechaDesde, fecha_hasta: f.fechaHasta,
        })),
      });
      if (!r.ok) { setError(r.error); return; }
      router.push("/solicitudes");
      router.refresh();
    });
  };

  return (
    <>
      <Link href="/solicitudes" style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 13, color: "var(--text2)", textDecoration: "none", marginBottom: 16,
      }}>
        <IconoAtras size={15} />
        Pedidos
      </Link>

      <h1 className="font-display" style={{
        fontSize: 22, fontWeight: 800, color: "var(--text)",
        letterSpacing: "-0.03em", marginBottom: 4,
      }}>
        Pedir un memo
      </h1>
      <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 20, lineHeight: 1.5 }}>
        {jefeNombre
          ? <>Le llegará a <strong>{jefeNombre}</strong> para su visto bueno. Recién
             cuando firme, Administración emite el memo.</>
          : <>Esto no es todavía un memo: es un pedido esperando una firma.</>}
      </p>

      {!jefeNombre && (
        <div style={{ marginBottom: 14 }}>
          <Aviso tono="aviso" icono={<IconoAlerta size={17} />}>
            No tienes una jefatura registrada, así que el pedido va a quedar sin
            destinatario y lo tendrá que tomar quien administre. Pídele a Sistema
            que te asigne tu jefatura.
          </Aviso>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 620 }}>
        <Tarjeta>
          <label className="fg-label">Tipo</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {TIPOS.map(t => (
              <button key={t.valor} onClick={() => setTipo(t.valor)} style={{
                padding: "7px 14px", borderRadius: 999, fontSize: 12.5, cursor: "pointer",
                fontWeight: 600, fontFamily: "var(--font-sora), sans-serif",
                border: `1px solid ${tipo === t.valor ? "var(--accent)" : "var(--border2)"}`,
                background: tipo === t.valor ? "rgba(0,162,152,0.08)" : "#FFFFFF",
                color: tipo === t.valor ? "var(--accent)" : "var(--text2)",
              }}>
                {t.etiqueta}
              </button>
            ))}
          </div>

          <label className="fg-label">Motivo</label>
          <input className="fg-input" value={motivo}
            onChange={e => setMotivo(e.target.value)}
            placeholder="Ej: instalación de talleres EPT en la IE Juan Espinoza" />
          {/* Es lo que la jefatura lee para decidir, y lo que después explica
              por qué existe el memo. Hasta ahora no quedaba escrito en ningún
              lado. */}
          <p style={{ marginTop: 6, fontSize: 11, color: "var(--text3)", lineHeight: 1.45 }}>
            Es lo que tu jefatura lee para decidir, y lo que mañana explica por
            qué existe este memo.
          </p>

          <div style={{ marginTop: 16 }}>
            <label className="fg-label">Centro de costos</label>
            <select className="fg-input" value={centro} onChange={e => setCentro(e.target.value)}>
              {centros.map(c => (
                <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
              ))}
            </select>
          </div>

          <div style={{ marginTop: 16 }}>
            <label className="fg-label">Destino</label>
            <input className="fg-input" value={destino}
              onChange={e => setDestino(e.target.value)}
              placeholder="Ej: Colegio Billinghurst — Puno" />
          </div>
        </Tarjeta>

        <Tarjeta>
          <SelectorDePersonas
            rotulo="¿Para quién?"
            personas={personas}
            elegidas={elegidas}
            onCambio={setElegidas}
            yo={yo}
          />
        </Tarjeta>

        {elegidas.length > 0 && (
          <Tarjeta>
            <label className="fg-label">Cuánto se estima para cada quien</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {elegidas.map(id => {
                const p = personas.find(x => x.id === id);
                const f = filas[id] ?? porOmision();
                return (
                  <div key={id} style={{
                    border: "1px solid var(--border2)", borderRadius: 10, padding: "11px 12px",
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                      {p?.nombre}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      <div>
                        <label className="fg-label" style={{ fontSize: 10.5 }}>Monto S/</label>
                        <input className="fg-input" type="number" inputMode="decimal"
                          step="0.01" min="0" value={f.monto} placeholder="212.00"
                          onChange={e => editar(id, "monto", e.target.value)}
                          style={{ fontWeight: 700 }} />
                      </div>
                      <div>
                        <label className="fg-label" style={{ fontSize: 10.5 }}>Desde</label>
                        <input className="fg-input" type="date" value={f.desde}
                          onChange={e => editar(id, "desde", e.target.value)} />
                      </div>
                      <div>
                        <label className="fg-label" style={{ fontSize: 10.5 }}>Hasta</label>
                        <input className="fg-input" type="date" value={f.hasta}
                          onChange={e => editar(id, "hasta", e.target.value)} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border2)",
            }}>
              <span style={{ fontSize: 12.5, color: "var(--text2)" }}>Total del pedido</span>
              <span className="font-display" style={{
                fontSize: 19, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em",
              }}>
                {soles(anexo.total)}
              </span>
            </div>
          </Tarjeta>
        )}

        {anexo.reparos.length > 0 && elegidas.length > 0 && (
          <Aviso tono="aviso" icono={<IconoAlerta size={17} />}>
            {anexo.reparos.join(" ")}
          </Aviso>
        )}

        {error && (
          <div style={{
            padding: "12px 14px", borderRadius: 10,
            background: "var(--danger-bg)", border: "1px solid rgba(220,38,38,0.2)",
          }}>
            <p style={{ fontSize: 12.5, color: "var(--danger)", lineHeight: 1.5 }}>{error}</p>
          </div>
        )}

        <button className="btn-primary" onClick={enviar} disabled={pendiente || !listo}
          style={{ justifyContent: "center", padding: 12 }}>
          {pendiente ? "Enviando…" : jefeNombre ? `Enviar a ${jefeNombre}` : "Enviar el pedido"}
        </button>
      </div>
    </>
  );
}
