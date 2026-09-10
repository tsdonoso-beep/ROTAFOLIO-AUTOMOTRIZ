"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Aviso, Tarjeta } from "./Encabezado";
import { IconoAlerta, IconoAtras, IconoCheck } from "./Iconos";
import { crearMemo, revisarPendientes, type PendientesDeAsignado } from "@/app/acciones/memos";

interface Props {
  centros: Array<{ id: string; codigo: string; nombre: string }>;
  personas: Array<{ id: string; nombre: string; dni: string; email: string | null }>;
  puedeAutorizarPendientes: boolean;
}

const TIPOS = [
  { valor: "CAJA_CHICA", etiqueta: "Caja chica" },
  { valor: "VIATICOS", etiqueta: "Viáticos" },
  { valor: "PASAJES", etiqueta: "Pasajes" },
  { valor: "OTRO", etiqueta: "Otro" },
];

const hoy = () => new Date().toISOString().slice(0, 10);
const enDias = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export default function FormularioMemo({ centros, personas, puedeAutorizarPendientes }: Props) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState("");

  const [tipo, setTipo] = useState("CAJA_CHICA");
  const [centro, setCentro] = useState(centros[0]?.id ?? "");
  const [asignados, setAsignados] = useState<string[]>([]);
  const [destino, setDestino] = useState("");
  const [salida, setSalida] = useState(hoy());
  const [retorno, setRetorno] = useState(enDias(7));
  const [monto, setMonto] = useState("");
  const [autorizar, setAutorizar] = useState(false);
  const [listoConAviso, setListoConAviso] = useState("");

  // La respuesta se guarda junto con la selección que la produjo. Así el
  // aviso nunca queda describiendo a una persona que ya se deseleccionó
  // mientras la consulta viajaba.
  const seleccion = asignados.join(",");
  const [consultado, setConsultado] = useState<{
    seleccion: string; lista: PendientesDeAsignado[];
  }>({ seleccion: "", lista: [] });

  // Se pregunta al cambiar la selección, no al enviar: quien abre el memo
  // debería enterarse de que la persona arrastra una rendición vencida
  // ANTES de llenar el monto y las fechas.
  useEffect(() => {
    if (!seleccion) return;
    let vigente = true;
    revisarPendientes(seleccion.split(","))
      .then(lista => { if (vigente) setConsultado({ seleccion, lista }); });
    return () => { vigente = false; };
  }, [seleccion]);

  const pendientes = consultado.seleccion === seleccion ? consultado.lista : [];
  const bloquean = pendientes.filter(p => p.bloquea);

  // Cuando hay bloqueo y quien crea el memo no puede levantarlo, el memo se
  // crea igual: queda en borrador y le llega la solicitud al jefe. Por eso
  // el botón no se traba —trabarlo dejaría a Administración sin salida—.
  const iraAJefatura = bloquean.length > 0 && !(puedeAutorizarPendientes && autorizar);

  const listo = centro && asignados.length > 0 && Number(monto) > 0;

  const alternar = (id: string) =>
    setAsignados(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id]);

  const enviar = (abrir: boolean) => {
    setError("");
    iniciar(async () => {
      const r = await crearMemo({
        tipo, centro_costo_id: centro, asignados, destino,
        fecha_salida: salida, fecha_retorno_prev: retorno,
        monto_autorizado: Number(monto), abrir,
        autorizar_pendientes: autorizar,
      });
      if (!r.ok) { setError(r.error); return; }
      // Cuando el memo quedó esperando una firma, no se navega: quien lo
      // creó tiene que enterarse de que no está abierto todavía.
      if (r.aviso) { setListoConAviso(r.aviso); router.refresh(); return; }
      router.push("/administrar");
      router.refresh();
    });
  };

  // El memo se creó pero no se abrió. Se dice acá y no en la bandeja
  // porque quien lo creó cree que terminó, y no terminó.
  if (listoConAviso) {
    return (
      <div style={{ maxWidth: 620 }}>
        <Tarjeta>
          <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
            <span style={{ color: "var(--warn)", marginTop: 1 }}>
              <IconoAlerta size={20} />
            </span>
            <div>
              <h1 className="font-display" style={{
                fontSize: 17, fontWeight: 800, color: "var(--text)",
                letterSpacing: "-0.02em", marginBottom: 6,
              }}>
                Falta una firma
              </h1>
              <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
                {listoConAviso}
              </p>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <Link href="/administrar" className="btn-primary"
              style={{ flex: 1, justifyContent: "center", textDecoration: "none" }}>
              Ver los memos
            </Link>
          </div>
        </Tarjeta>
      </div>
    );
  }

  return (
    <>
      <Link href="/administrar" style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 13, color: "var(--text2)", textDecoration: "none", marginBottom: 16,
      }}>
        <IconoAtras size={15} />
        Administrar memos
      </Link>

      <h1 className="font-display" style={{
        fontSize: 22, fontWeight: 800, color: "var(--text)",
        letterSpacing: "-0.03em", marginBottom: 4,
      }}>
        Nuevo memo
      </h1>
      <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 20, lineHeight: 1.5 }}>
        El correlativo lo genera el sistema. Al abrirlo aparece en «Mis memos» de las
        personas asignadas.
      </p>

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

          <label className="fg-label">Centro de costos</label>
          <select className="fg-input" value={centro} onChange={e => setCentro(e.target.value)}>
            {centros.map(c => (
              <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
            ))}
          </select>
          <p style={{ marginTop: 6, fontSize: 11, color: "var(--text3)", lineHeight: 1.45 }}>
            Sale del catálogo. El rendidor ya no lo escribe a mano.
          </p>
        </Tarjeta>

        <Tarjeta>
          <label className="fg-label">¿Quién rinde?</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {personas.map(p => {
              const activo = asignados.includes(p.id);
              return (
                <button key={p.id} onClick={() => alternar(p.id)} style={{
                  display: "flex", alignItems: "center", gap: 11, padding: "10px 13px",
                  borderRadius: 10, cursor: "pointer", textAlign: "left",
                  border: `1px solid ${activo ? "var(--accent)" : "var(--border2)"}`,
                  background: activo ? "rgba(0,162,152,0.05)" : "#FFFFFF",
                }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                    border: `1px solid ${activo ? "var(--accent)" : "var(--border2)"}`,
                    background: activo ? "var(--accent)" : "#FFFFFF",
                    color: "#FFFFFF", fontSize: 12,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {activo && <IconoCheck size={13} />}
                  </span>
                  <span style={{ flex: 1 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", display: "block" }}>
                      {p.nombre}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text3)" }}>
                      <span className="mono">{p.dni}</span>
                      {p.email && ` · ${p.email}`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </Tarjeta>

        {pendientes.length > 0 && (
          <Aviso tono={bloquean.length ? "error" : "aviso"} icono={<IconoAlerta size={17} />}>
            <strong style={{ fontFamily: "var(--font-sora), sans-serif" }}>
              {bloquean.length ? "Rendiciones vencidas." : "Ojo con lo pendiente."}
            </strong>{" "}
            {pendientes.map(p => p.motivo).join(" ")}
            {bloquean.length > 0 && (
              puedeAutorizarPendientes ? (
                <label style={{
                  display: "flex", alignItems: "flex-start", gap: 9, marginTop: 11,
                  cursor: "pointer", lineHeight: 1.45,
                }}>
                  <input type="checkbox" checked={autorizar}
                    onChange={e => setAutorizar(e.target.checked)}
                    style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, cursor: "pointer" }} />
                  <span style={{ fontSize: 12.5 }}>
                    Doy el visto bueno para abrir el memo igual. Queda registrado a mi
                    nombre en la bitácora.
                  </span>
                </label>
              ) : (
                <span style={{ display: "block", marginTop: 8, fontSize: 12.5 }}>
                  Puedes crearlo igual: quedará en borrador y le llegará la solicitud
                  al jefe de esa persona. Se abre cuando responda.
                </span>
              )
            )}
          </Aviso>
        )}

        <Tarjeta>
          <label className="fg-label">Monto autorizado (S/)</label>
          <input
            className="fg-input" type="number" inputMode="decimal" step="0.01" min="0"
            value={monto} onChange={e => setMonto(e.target.value)} placeholder="2000.00"
            style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-sora), sans-serif" }}
          />
          <p style={{ marginTop: 6, fontSize: 11, color: "var(--text3)", lineHeight: 1.45 }}>
            Con esto la app calcula saldo, devolución y exceso, y avisa si la rendición
            se pasa.
          </p>

          <div style={{ marginTop: 16 }}>
            <label className="fg-label">Destino</label>
            <input className="fg-input" value={destino} onChange={e => setDestino(e.target.value)}
              placeholder="Ej: Colegio Billinghurst — Puno" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11, marginTop: 16 }}>
            <div>
              <label className="fg-label">Salida</label>
              <input className="fg-input" type="date" value={salida} onChange={e => setSalida(e.target.value)} />
            </div>
            <div>
              <label className="fg-label">Retorno previsto</label>
              <input className="fg-input" type="date" value={retorno} onChange={e => setRetorno(e.target.value)} />
            </div>
          </div>
          <p style={{ marginTop: 6, fontSize: 11, color: "var(--text3)", lineHeight: 1.45 }}>
            Un comprobante fechado fuera de este rango genera una alerta.
          </p>
        </Tarjeta>

        {error && (
          <div style={{
            padding: "12px 14px", borderRadius: 10,
            background: "var(--danger-bg)", border: "1px solid rgba(220,38,38,0.2)",
          }}>
            <p style={{ fontSize: 12.5, color: "var(--danger)", lineHeight: 1.5 }}>{error}</p>
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-ghost" onClick={() => enviar(false)} disabled={pendiente || !listo}
            style={{ flex: 1, justifyContent: "center" }}>
            Guardar borrador
          </button>
          <button className="btn-primary" onClick={() => enviar(true)} disabled={pendiente || !listo}
            style={{ flex: 2, justifyContent: "center", padding: 12 }}>
            {pendiente ? "Creando…"
              : iraAJefatura ? "Crear y pedir el visto bueno"
              : "Crear y abrir memo"}
          </button>
        </div>
        <p style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.45, marginTop: -4 }}>
          Un borrador no es visible para el rendidor hasta que lo abras.
        </p>
      </div>
    </>
  );
}
