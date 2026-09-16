"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Aviso, Tarjeta } from "./Encabezado";
import { IconoAlerta, IconoAtras, IconoCheck } from "./Iconos";
import { crearMemo, revisarPendientes, type PendientesDeAsignado } from "@/app/acciones/memos";
import { revisarAnexo, tramos } from "@/lib/dominio/anexo";

interface Props {
  centros: Array<{ id: string; codigo: string; nombre: string }>;
  personas: Array<{ id: string; nombre: string; dni: string; email: string | null }>;
  /** Viáticos vivos a los que puede colgarse un memo de pasajes. */
  padres?: Array<{ id: string; correlativo: string; destino: string | null }>;
  puedeAutorizarPendientes: boolean;
}

// Los cinco que existen, en el orden en que ocurren. Hospedaje va primero
// porque es el más frecuente: 65 de los 125 memos del seguimiento.
const TIPOS = [
  { valor: "HOSPEDAJE", etiqueta: "Hospedaje" },
  { valor: "VIATICOS", etiqueta: "Viáticos" },
  { valor: "CAJA_CHICA", etiqueta: "Caja chica" },
  { valor: "PASAJES", etiqueta: "Pasajes" },
  { valor: "REEMBOLSO", etiqueta: "Reembolso" },
  { valor: "OTRO", etiqueta: "Otro" },
];

const soles = (n: number) =>
  n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Fila { monto: string; desde: string; hasta: string }

const hoy = () => new Date().toISOString().slice(0, 10);
const enDias = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const porOmision = (): Fila => ({ monto: "", desde: hoy(), hasta: enDias(7) });

export default function FormularioMemo({
  centros, personas, padres = [], puedeAutorizarPendientes,
}: Props) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState("");

  const [tipo, setTipo] = useState("HOSPEDAJE");
  const [centro, setCentro] = useState(centros[0]?.id ?? "");
  const [asignados, setAsignados] = useState<string[]>([]);
  const [destino, setDestino] = useState("");
  // Lo que le toca a cada quien. La clave es el id de la persona, así que
  // deseleccionarla y volver a marcarla no le pierde lo ya escrito.
  const [filas, setFilas] = useState<Record<string, Fila>>({});
  const [autorizar, setAutorizar] = useState(false);
  const [padre, setPadre] = useState("");
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

  // El anexo se revisa con la misma función que usa el servidor, así que el
  // formulario no puede permitir algo que la acción vaya a rechazar.
  const deAnexo = asignados.map(id => {
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
  const grupos = tramos(deAnexo);

  const listo = Boolean(centro) && anexo.reparos.length === 0;

  const alternar = (id: string) =>
    setAsignados(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id]);

  const editar = (id: string, campo: keyof Fila, valor: string) =>
    setFilas(f => ({ ...f, [id]: { ...(f[id] ?? porOmision()), [campo]: valor } }));

  // El 594-2026 tiene cuatro personas con el mismo monto y el mismo tramo.
  // Copiar la primera fila al resto evita teclear once veces lo mismo.
  const copiarATodos = () => {
    const primera = filas[asignados[0]] ?? porOmision();
    setFilas(f => {
      const n = { ...f };
      for (const id of asignados) n[id] = { ...primera };
      return n;
    });
  };

  const enviar = (abrir: boolean) => {
    setError("");
    iniciar(async () => {
      const r = await crearMemo({
        tipo, centro_costo_id: centro, destino, abrir,
        memo_referido_id: tipo === "PASAJES" ? (padre || null) : null,
        asignados: deAnexo.map(f => ({
          usuario_id: f.usuarioId, nombre: f.nombre, monto: f.monto,
          fecha_desde: f.fechaDesde, fecha_hasta: f.fechaHasta,
        })),
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

          {/* Un memo de pasajes es hijo de un viático: se emite con la fecha
              de ida y se completa después con la de vuelta, porque al abrirlo
              nadie sabe cuándo termina la obra. */}
          {tipo === "PASAJES" && (
            <div style={{ marginTop: 16 }}>
              <label className="fg-label">Viático del que depende</label>
              <select className="fg-input" value={padre}
                onChange={e => setPadre(e.target.value)}>
                <option value="">— sin memo padre —</option>
                {padres.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.correlativo}{m.destino ? ` — ${m.destino}` : ""}
                  </option>
                ))}
              </select>
              <p style={{ marginTop: 6, fontSize: 11, color: "var(--text3)", lineHeight: 1.45 }}>
                Sin padre, el pasaje queda como un gasto suelto que nadie sabe
                a qué viaje pertenece. La fecha de retorno se completa después,
                cuando se sepa.
              </p>
            </div>
          )}
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

        {asignados.length > 0 && (
          <Tarjeta>
            <div style={{
              display: "flex", alignItems: "baseline",
              justifyContent: "space-between", marginBottom: 4,
            }}>
              <label className="fg-label" style={{ marginBottom: 0 }}>
                Anexo — qué le toca a cada quien
              </label>
              {asignados.length > 1 && (
                <button onClick={copiarATodos} style={{
                  background: "none", border: "none", cursor: "pointer", padding: 0,
                  fontSize: 11.5, color: "var(--accent)", fontWeight: 600,
                  fontFamily: "var(--font-sora), sans-serif",
                }}>
                  Copiar la primera a todos
                </button>
              )}
            </div>
            <p style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.45, marginBottom: 12 }}>
              Un mismo memo puede darle S/ 212.00 y dos días a una persona y
              S/ 1,164.00 y once a otra. El total del memo sale de sumar esto.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {asignados.map(id => {
                const p = personas.find(x => x.id === id);
                const f = filas[id] ?? porOmision();
                return (
                  <div key={id} style={{
                    border: "1px solid var(--border2)", borderRadius: 10, padding: "11px 12px",
                  }}>
                    <div style={{
                      display: "flex", justifyContent: "space-between",
                      alignItems: "baseline", marginBottom: 8,
                    }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                        {p?.nombre}
                      </span>
                      <span className="mono" style={{ fontSize: 10.5, color: "var(--text3)" }}>
                        {p?.dni}
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      <div>
                        <label className="fg-label" style={{ fontSize: 10.5 }}>Monto S/</label>
                        <input className="fg-input" type="number" inputMode="decimal"
                          step="0.01" min="0" placeholder="212.00" value={f.monto}
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

            {/* El total no se teclea: se suma. Un total escrito a mano puede
                contradecir a su propio anexo, y eso pasa en los memos reales. */}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border2)",
            }}>
              <span style={{ fontSize: 12.5, color: "var(--text2)" }}>
                Monto autorizado del memo
              </span>
              <span className="font-display" style={{
                fontSize: 19, fontWeight: 800, color: "var(--text)",
                letterSpacing: "-0.02em",
              }}>
                S/ {soles(anexo.total)}
              </span>
            </div>

            {grupos.length > 1 && (
              <p style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.5, marginTop: 8 }}>
                {grupos.length} tramos distintos:{" "}
                {grupos.map((g, i) => (
                  <span key={i}>
                    {i > 0 && " · "}
                    {g.personas} {g.personas === 1 ? "persona" : "personas"}
                    {g.montoCadaUno != null && ` a S/ ${soles(g.montoCadaUno)}`}
                  </span>
                ))}
              </p>
            )}

            <div style={{ marginTop: 16 }}>
              <label className="fg-label">Destino</label>
              <input className="fg-input" value={destino} onChange={e => setDestino(e.target.value)}
                placeholder="Ej: Colegio Billinghurst — Puno" />
            </div>

            {anexo.desde && (
              <p style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.45, marginTop: 10 }}>
                La cabecera del memo va del {anexo.desde} al {anexo.hasta}: abarca a
                todos. Cada comprobante se valida contra el tramo de su dueño, no
                contra este.
              </p>
            )}
          </Tarjeta>
        )}

        {anexo.reparos.length > 0 && asignados.length > 0 && (
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
