import { IconoCheck, IconoReloj } from "./Iconos";

export function Encabezado({ titulo, bajada, accion }: {
  titulo: string;
  bajada?: string;
  accion?: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
      gap: 18, flexWrap: "wrap", marginBottom: 24,
    }}>
      <div style={{ minWidth: 0 }}>
        <h1 className="font-display" style={{
          fontSize: 27, fontWeight: 800, color: "var(--text)",
          letterSpacing: "-0.035em", lineHeight: 1.15,
        }}>
          {titulo}
        </h1>
        {bajada && (
          <p style={{
            fontSize: 14, color: "var(--text2)", marginTop: 6,
            lineHeight: 1.55, maxWidth: 620,
          }}>
            {bajada}
          </p>
        )}
      </div>
      {accion}
    </div>
  );
}

export function Tarjeta({ children, padding = 20, className = "", style }: {
  children: React.ReactNode;
  padding?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`tarjeta ${className}`} style={{ padding, ...style }}>
      {children}
    </div>
  );
}

/**
 * Estado vacío con acción.
 *
 * Un vacío sin salida deja al usuario preguntándose qué hacer; por eso
 * lleva siempre el siguiente paso a mano cuando existe.
 */
export function Vacio({ icono, titulo, texto, accion }: {
  icono: React.ReactNode;
  titulo: string;
  texto: string;
  accion?: React.ReactNode;
}) {
  return (
    <div className="tarjeta" style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "56px 24px", textAlign: "center", gap: 16,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 16,
        background: "var(--surface2)", border: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text3)",
      }}>
        {icono}
      </div>
      <div>
        <p className="font-display" style={{
          fontSize: 16.5, fontWeight: 700, color: "var(--text)",
          letterSpacing: "-0.02em", marginBottom: 6,
        }}>
          {titulo}
        </p>
        <p style={{ fontSize: 13.5, color: "var(--text2)", lineHeight: 1.6, maxWidth: 380 }}>
          {texto}
        </p>
      </div>
      {accion}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Estado del memo
// ════════════════════════════════════════════════════════════════

const ESTADO: Record<string, { clase: string; etiqueta: string }> = {
  BORRADOR:      { clase: "badge-neutro", etiqueta: "Borrador" },
  ABIERTO:       { clase: "badge-acento", etiqueta: "Abierto" },
  EN_RENDICION:  { clase: "badge-acento", etiqueta: "En rendición" },
  PRESENTADA:    { clase: "badge-warn",   etiqueta: "Presentada" },
  OBSERVADA:     { clase: "badge-error",  etiqueta: "Observada" },
  APROBADA:      { clase: "badge-ok",     etiqueta: "Aprobada" },
  CONTABILIZADA: { clase: "badge-ok",     etiqueta: "Contabilizada" },
  CERRADO:       { clase: "badge-neutro", etiqueta: "Cerrado" },
  ANULADO:       { clase: "badge-neutro", etiqueta: "Anulado" },
};

export function EstadoMemo({ estado }: { estado: string }) {
  const e = ESTADO[estado] ?? ESTADO.BORRADOR;
  return <span className={`badge ${e.clase}`}>{e.etiqueta}</span>;
}

// ════════════════════════════════════════════════════════════════
// Medidor de consumo
// ════════════════════════════════════════════════════════════════

/**
 * Barra de consumo del memo.
 *
 * El color cambia según cuánto queda: teal mientras hay holgura, ámbar
 * al acercarse al tope y rojo al pasarse. Así el estado se percibe antes
 * de leer las cifras. La pista siempre es visible, también en cero — una
 * barra vacía sigue comunicando "no has rendido nada".
 */
export function Medidor({ rendido, autorizado }: { rendido: number; autorizado: number }) {
  const proporcion = autorizado > 0 ? rendido / autorizado : 0;
  const excedido = rendido > autorizado;
  const porcentaje = Math.min(100, Math.max(0, proporcion * 100));

  const color = excedido ? "var(--danger)"
    : proporcion >= 0.85 ? "var(--warn)"
    : "var(--accent)";

  return (
    <div
      className="medidor"
      role="progressbar"
      aria-valuenow={Math.round(porcentaje)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Consumido ${Math.round(porcentaje)} por ciento del monto autorizado`}
    >
      <div className="medidor-relleno" style={{ width: `${porcentaje}%`, background: color }} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Cifra con rótulo
// ════════════════════════════════════════════════════════════════

/**
 * Bloque de monto. En una app de rendiciones las cifras son el
 * contenido, no un dato de apoyo: van grandes y con ancho tabular.
 */
export function Cifra({ rotulo, valor, tono = "neutro", tamano = "l" }: {
  rotulo: string;
  valor: string;
  tono?: "neutro" | "acento" | "peligro" | "aviso" | "tenue";
  tamano?: "xl" | "l" | "m";
}) {
  const color = {
    neutro:  "var(--text)",
    acento:  "var(--accent-texto)",
    peligro: "var(--danger)",
    aviso:   "var(--warn)",
    tenue:   "var(--text3)",
  }[tono];

  return (
    <div>
      <p className={`cifra cifra-${tamano}`} style={{ color }}>{valor}</p>
      <p className="rotulo" style={{ marginTop: 5 }}>{rotulo}</p>
    </div>
  );
}

/** Aviso en línea: alerta, error o confirmación. */
export function Aviso({ tono, icono, children }: {
  tono: "error" | "aviso" | "ok" | "info";
  icono?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = {
    error: { bg: "var(--danger-bg)",  bd: "var(--danger-borde)",  fg: "var(--danger)" },
    aviso: { bg: "var(--warn-bg)",    bd: "var(--warn-borde)",    fg: "var(--warn)" },
    ok:    { bg: "var(--success-bg)", bd: "var(--success-borde)", fg: "var(--success)" },
    info:  { bg: "var(--accent-suave)", bd: "var(--accent-borde)", fg: "var(--accent-texto)" },
  }[tono];

  return (
    <div style={{
      padding: "13px 15px", borderRadius: "var(--radio-s)",
      background: t.bg, border: `1px solid ${t.bd}`,
      display: "flex", gap: 10, alignItems: "flex-start",
    }}>
      {icono && <span style={{ color: t.fg, marginTop: 1 }}>{icono}</span>}
      <div style={{ fontSize: 13, color: t.fg, lineHeight: 1.55, flex: 1 }}>
        {children}
      </div>
    </div>
  );
}

export const soles = (n: number) =>
  `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Días de atraso con su señal visual. */
export function Atraso({ dias }: { dias: number }) {
  if (dias <= 0) return null;
  return (
    <span className={`badge ${dias > 15 ? "badge-error" : "badge-warn"}`}>
      <IconoReloj size={11} style={{ marginLeft: -1 }} />
      {dias} {dias === 1 ? "día" : "días"} de atraso
    </span>
  );
}

export function Listo() {
  return (
    <span className="badge badge-ok">
      <IconoCheck size={11} style={{ marginLeft: -1 }} />
      Al día
    </span>
  );
}
