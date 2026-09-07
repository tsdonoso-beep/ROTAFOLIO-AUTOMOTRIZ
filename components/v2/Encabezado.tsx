export function Encabezado({ titulo, bajada, accion }: {
  titulo: string;
  bajada?: string;
  accion?: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
      gap: 16, flexWrap: "wrap", marginBottom: 20,
    }}>
      <div>
        <h1 className="font-display" style={{
          fontSize: 24, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.03em",
        }}>
          {titulo}
        </h1>
        {bajada && (
          <p style={{ fontSize: 13, color: "var(--text2)", marginTop: 4, lineHeight: 1.5 }}>
            {bajada}
          </p>
        )}
      </div>
      {accion}
    </div>
  );
}

export function Tarjeta({ children, padding = 18 }: {
  children: React.ReactNode; padding?: number;
}) {
  return (
    <div style={{
      background: "#FFFFFF",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      {children}
    </div>
  );
}

export function Vacio({ icono, titulo, texto }: {
  icono: string; titulo: string; texto: string;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "56px 20px", textAlign: "center", gap: 14,
    }}>
      <div style={{
        width: 68, height: 68, borderRadius: 20,
        background: "#FFFFFF", border: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 30, boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
      }}>
        {icono}
      </div>
      <div>
        <p className="font-display" style={{
          fontSize: 16, fontWeight: 700, color: "var(--text)",
          letterSpacing: "-0.02em", marginBottom: 5,
        }}>
          {titulo}
        </p>
        <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, maxWidth: 340 }}>
          {texto}
        </p>
      </div>
    </div>
  );
}

/** Colores del estado del memo, coherentes en todas las pantallas. */
const COLOR_ESTADO: Record<string, { fondo: string; texto: string }> = {
  BORRADOR:      { fondo: "rgba(0,0,0,0.05)",      texto: "var(--text2)" },
  ABIERTO:       { fondo: "rgba(4,95,108,0.09)",   texto: "var(--accent)" },
  EN_RENDICION:  { fondo: "rgba(4,95,108,0.09)",   texto: "var(--accent)" },
  PRESENTADA:    { fondo: "var(--warn-bg)",        texto: "var(--warn)" },
  OBSERVADA:     { fondo: "var(--danger-bg)",      texto: "var(--danger)" },
  APROBADA:      { fondo: "var(--success-bg)",     texto: "var(--success)" },
  CONTABILIZADA: { fondo: "var(--success-bg)",     texto: "var(--success)" },
  CERRADO:       { fondo: "rgba(0,0,0,0.05)",      texto: "var(--text3)" },
  ANULADO:       { fondo: "rgba(0,0,0,0.05)",      texto: "var(--text3)" },
};

const ETIQUETA_ESTADO: Record<string, string> = {
  BORRADOR: "Borrador",
  ABIERTO: "Abierto",
  EN_RENDICION: "En rendición",
  PRESENTADA: "Presentada",
  OBSERVADA: "Observada",
  APROBADA: "Aprobada",
  CONTABILIZADA: "Contabilizada",
  CERRADO: "Cerrado",
  ANULADO: "Anulado",
};

export function EstadoMemo({ estado }: { estado: string }) {
  const c = COLOR_ESTADO[estado] ?? COLOR_ESTADO.BORRADOR;
  return (
    <span className="badge" style={{ background: c.fondo, color: c.texto }}>
      {ETIQUETA_ESTADO[estado] ?? estado}
    </span>
  );
}

export const soles = (n: number) =>
  `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
