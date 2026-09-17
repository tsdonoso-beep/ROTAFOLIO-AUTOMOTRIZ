"use client";
import { useMemo, useState } from "react";
import { IconoCheck, IconoMas } from "./Iconos";
import {
  buscarPersonas, cuadrillasSugeridas, valoresPara,
  type Cuadrilla, type Persona,
} from "@/lib/dominio/personas";

/**
 * Elegir personas de una lista de ciento veinticuatro.
 *
 * El desplegable anterior las mostraba todas, en orden alfabético y sin
 * buscador: para encontrar a Wilmer había que bajar hasta la W. La primera
 * idea fue pedir el área antes de elegir, pero los datos la descartan — el
 * 64% de las asignaciones son de gente sin área, que es justamente la que
 * viaja. Un paso previo obligatorio la escondería, y quien arma el memo
 * concluiría que esa persona no está registrada.
 *
 * Así que: se escribe. Tres letras dejan uno o dos nombres. El área y el
 * cargo quedan como chips que acotan si sirven, nunca como puerta de
 * entrada. Y para los memos de cuadrilla —el 594-2026 tiene once personas—
 * se copia la del memo anterior y se quita a quien no va.
 */
export default function SelectorDePersonas({
  personas, elegidas, onCambio, cuadrillas = [], centroCostoId = null,
  rotulo = "¿Para quién?", yo,
}: {
  personas: Persona[];
  elegidas: string[];
  onCambio: (ids: string[]) => void;
  cuadrillas?: Cuadrilla[];
  centroCostoId?: string | null;
  rotulo?: string;
  /** Quien está usando la aplicación, para marcarlo con un «(tú)». */
  yo?: string;
}) {
  const [consulta, setConsulta] = useState("");
  const [area, setArea] = useState<string | null>(null);
  const [cargo, setCargo] = useState<string | null>(null);
  const [verTodas, setVerTodas] = useState(false);

  const areas = useMemo(() => valoresPara(personas, "area"), [personas]);
  const cargos = useMemo(() => valoresPara(personas, "cargo"), [personas]);

  const halladas = useMemo(
    () => buscarPersonas(personas, { consulta, area, cargo }),
    [personas, consulta, area, cargo]
  );

  // Las elegidas van arriba siempre: si no, al escribir desaparecen de la
  // vista y uno pierde la cuenta de a quién ya marcó.
  const arriba = personas.filter(p => elegidas.includes(p.id));
  const resto = halladas.filter(p => !elegidas.includes(p.id));

  // Con la lista entera desplegada nadie encuentra nada. Se muestran las
  // primeras y se ofrece el resto con un botón, para que nunca quede
  // escondido de verdad.
  const TOPE = 8;
  const recortada = verTodas || consulta.trim() ? resto : resto.slice(0, TOPE);
  const ocultas = resto.length - recortada.length;

  const sugeridas = useMemo(
    () => cuadrillasSugeridas(cuadrillas, centroCostoId),
    [cuadrillas, centroCostoId]
  );

  const alternar = (id: string) =>
    onCambio(elegidas.includes(id) ? elegidas.filter(x => x !== id) : [...elegidas, id]);

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between",
        gap: 10, marginBottom: 9,
      }}>
        <label className="fg-label" style={{ marginBottom: 0 }}>{rotulo}</label>
        {elegidas.length > 0 && (
          <button onClick={() => onCambio([])} style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            fontSize: 11.5, color: "var(--text3)",
            fontFamily: "var(--font-sora), sans-serif",
          }}>
            Quitar {elegidas.length}
          </button>
        )}
      </div>

      {/* ── Copiar una cuadrilla ── */}
      {sugeridas.length > 0 && elegidas.length === 0 && (
        <div style={{ marginBottom: 11 }}>
          <p style={{ fontSize: 11, color: "var(--text3)", marginBottom: 7, lineHeight: 1.45 }}>
            O copia la gente de un memo anterior y quita a quien no va:
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {sugeridas.map(c => (
              <button key={c.memoId} onClick={() => onCambio(c.personas)} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
                borderRadius: 999, cursor: "pointer", background: "var(--accent-suave)",
                border: "1px solid var(--accent-borde)", color: "var(--accent-texto)",
                fontFamily: "var(--font-sora), sans-serif", fontSize: 12, fontWeight: 600,
              }}>
                <IconoMas size={13} />
                {c.personas.length} de {c.destino || c.correlativo}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Escribir, que es el arreglo de verdad ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 9, padding: "10px 13px",
        borderRadius: "var(--radio-s)", background: "var(--surface)",
        border: "1px solid var(--border2)",
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text3)"
          strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" />
        </svg>
        <input
          id="buscar-persona"
          value={consulta}
          onChange={e => setConsulta(e.target.value)}
          placeholder={`Escribe un nombre, DNI o cargo · ${personas.length} personas`}
          aria-label="Buscar una persona"
          style={{
            flex: 1, minWidth: 0, border: "none", background: "transparent",
            outline: "none", fontSize: 13.5, color: "var(--text)",
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}
        />
        {consulta && (
          <button onClick={() => setConsulta("")} aria-label="Limpiar la búsqueda" style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text3)", fontSize: 17, lineHeight: 1, padding: 0,
          }}>
            ×
          </button>
        )}
      </div>

      {/* ── Chips que acotan, nunca una puerta de entrada ── */}
      {(areas.length > 0 || cargos.length > 0) && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 9 }}>
          {[...cargos.slice(0, 4).map(c => ({ ...c, tipo: "cargo" as const })),
            ...areas.slice(0, 3).map(a => ({ ...a, tipo: "area" as const }))]
            .map(c => {
              const activo = c.tipo === "cargo" ? cargo === c.valor : area === c.valor;
              return (
                <button key={`${c.tipo}-${c.valor}`}
                  onClick={() => c.tipo === "cargo"
                    ? setCargo(activo ? null : c.valor)
                    : setArea(activo ? null : c.valor)}
                  style={{
                    padding: "5px 11px", borderRadius: 999, cursor: "pointer",
                    fontFamily: "var(--font-sora), sans-serif", fontSize: 11,
                    fontWeight: activo ? 700 : 600, whiteSpace: "nowrap",
                    border: `1px solid ${activo ? "var(--accent)" : "var(--border2)"}`,
                    background: activo ? "var(--accent-suave)" : "var(--surface)",
                    color: activo ? "var(--accent-texto)" : "var(--text3)",
                  }}>
                  {/* El área trae un prefijo «IRP 10 - » que no aporta al elegir. */}
                  {c.valor.replace(/^IRP \d+ - /, "").toLowerCase()} · {c.cuantos}
                </button>
              );
            })}
        </div>
      )}

      {/* ── Las filas ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 11 }}>
        {arriba.map(p => (
          <Fila key={p.id} p={p} elegida yo={yo} onClick={() => alternar(p.id)} />
        ))}

        {arriba.length > 0 && recortada.length > 0 && (
          <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />
        )}

        {recortada.map(p => (
          <Fila key={p.id} p={p} yo={yo} onClick={() => alternar(p.id)} />
        ))}

        {halladas.length === 0 && (
          <p style={{
            fontSize: 12.5, color: "var(--text3)", lineHeight: 1.5, padding: "10px 2px",
          }}>
            Nadie con «{consulta}»
            {(area || cargo) && " en ese filtro"}. Prueba con el apellido o el DNI
            {(area || cargo) && ", o quita el filtro"}.
          </p>
        )}

        {ocultas > 0 && (
          <button onClick={() => setVerTodas(true)} style={{
            background: "none", border: "none", cursor: "pointer", textAlign: "left",
            padding: "8px 2px", fontSize: 12, color: "var(--accent-texto)",
            fontFamily: "var(--font-sora), sans-serif", fontWeight: 600,
          }}>
            Ver las {ocultas} restantes
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Una fila, no una tarjeta.
 *
 * Con una tarjeta de 90px por persona, 124 personas son once mil píxeles de
 * scroll. Una fila compacta lleva lo mismo —nombre, DNI y en qué trabaja— en
 * un tercio del alto.
 */
function Fila({ p, elegida, yo, onClick }: {
  p: Persona; elegida?: boolean; yo?: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} aria-pressed={elegida} style={{
      display: "flex", alignItems: "center", gap: 10, width: "100%",
      padding: "8px 11px", borderRadius: 9, cursor: "pointer", textAlign: "left",
      border: `1px solid ${elegida ? "var(--accent)" : "transparent"}`,
      background: elegida ? "var(--accent-suave)" : "transparent",
    }}>
      <span style={{
        width: 17, height: 17, borderRadius: 4, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        border: `1.5px solid ${elegida ? "var(--accent)" : "var(--border2)"}`,
        background: elegida ? "var(--accent)" : "var(--surface)", color: "#FFFFFF",
      }}>
        {elegida && <IconoCheck size={11} />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: "block", fontSize: 13, fontWeight: 600, color: "var(--text)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {p.nombre}
          {p.id === yo && <span style={{ color: "var(--text3)", fontWeight: 400 }}> (tú)</span>}
        </span>
        <span style={{
          display: "block", fontSize: 11, color: "var(--text3)", marginTop: 1,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          <span className="mono">{p.dni}</span>
          {p.cargo && ` · ${p.cargo.toLowerCase()}`}
        </span>
      </span>
    </button>
  );
}
