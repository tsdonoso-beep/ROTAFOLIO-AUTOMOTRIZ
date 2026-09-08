/**
 * Set de iconos propio — reemplaza los emoji.
 *
 * Los emoji se renderizan distinto en cada sistema operativo, tienen pesos
 * ópticos incompatibles entre sí y no heredan el color del texto. Un set
 * propio en SVG resuelve las tres cosas: mismo trazo en todas partes, misma
 * densidad visual y `currentColor` para que sigan al contexto.
 *
 * Rejilla de 24, trazo de 1.75 con extremos redondeados.
 */

interface Props {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

function Svg({ size = 20, children, className, style }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round"
      className={className} style={{ flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// ── Navegación ──────────────────────────────────────────────────

export const IconoMemos = (p: Props) => (
  <Svg {...p}>
    <path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
    <rect x="9" y="2.5" width="6" height="3.5" rx="1" />
    <path d="M9 12h6M9 16h4" />
  </Svg>
);

export const IconoAdministrar = (p: Props) => (
  <Svg {...p}>
    <path d="M3 7.5a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.5.7l.9 1.1H19a2 2 0 0 1 2 2v7.2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M7 5.5V4a1.5 1.5 0 0 1 1.5-1.5h3" />
  </Svg>
);

export const IconoRevisar = (p: Props) => (
  <Svg {...p}>
    <path d="M12 2.8 4.5 5.6v5.6c0 4.5 3.1 8.7 7.5 9.9 4.4-1.2 7.5-5.4 7.5-9.9V5.6z" />
    <path d="m9.2 11.8 2 2 3.7-3.9" />
  </Svg>
);

export const IconoContabilidad = (p: Props) => (
  <Svg {...p}>
    <path d="M5 4.5A2 2 0 0 1 7 2.5h11a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a2 2 0 0 0-2 2z" />
    <path d="M5 4.5v15" />
    <path d="M9 7h6M9 10.5h6" />
  </Svg>
);

export const IconoTablero = (p: Props) => (
  <Svg {...p}>
    <path d="M3.5 20.5h17" />
    <rect x="5" y="12" width="3.6" height="6" rx="1" />
    <rect x="10.2" y="7" width="3.6" height="11" rx="1" />
    <rect x="15.4" y="9.5" width="3.6" height="8.5" rx="1" />
  </Svg>
);

export const IconoSistema = (p: Props) => (
  <Svg {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2.2" />
    <circle cx="9" cy="17" r="2.2" />
  </Svg>
);

// ── Captura ─────────────────────────────────────────────────────

export const IconoCamara = (p: Props) => (
  <Svg {...p}>
    <path d="M3 8.5a2 2 0 0 1 2-2h1.8a1 1 0 0 0 .83-.45l.94-1.4a1 1 0 0 1 .83-.45h5.2a1 1 0 0 1 .83.45l.94 1.4a1 1 0 0 0 .83.45H19a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <circle cx="12" cy="12.5" r="3.4" />
  </Svg>
);

export const IconoGaleria = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="m3.5 16.5 4.3-4.1a2 2 0 0 1 2.7-.05l3.4 3.05" />
    <path d="m13 14.2 2.2-2a2 2 0 0 1 2.65-.03l2.65 2.3" />
  </Svg>
);

export const IconoComprobante = (p: Props) => (
  <Svg {...p}>
    <path d="M5.5 3.5h13v17l-2.2-1.5-2.2 1.5-2.1-1.5-2.2 1.5-2.1-1.5-2.2 1.5z" />
    <path d="M9 8h6M9 12h6" />
  </Svg>
);

export const IconoBandeja = (p: Props) => (
  <Svg {...p}>
    <path d="M3.5 13.5h4l1.3 2.4h6.4l1.3-2.4h4" />
    <path d="M6.4 4.5h11.2a2 2 0 0 1 1.9 1.4l1.5 6.1v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5l1.5-6.1a2 2 0 0 1 1.9-1.4z" />
  </Svg>
);

// ── Estado y señales ────────────────────────────────────────────

export const IconoAlerta = (p: Props) => (
  <Svg {...p}>
    <path d="M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
    <path d="M12 9.5v4M12 17.2h.01" />
  </Svg>
);

export const IconoBloqueo = (p: Props) => (
  <Svg {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
    <path d="M8 10.5V7.4a4 4 0 0 1 8 0v3.1" />
  </Svg>
);

export const IconoCheck = (p: Props) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Svg>
);

export const IconoReloj = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.3l3.2 2" />
  </Svg>
);

export const IconoComentario = (p: Props) => (
  <Svg {...p}>
    <path d="M20.5 12.2a7.6 7.6 0 0 1-8.2 7.6 8.6 8.6 0 0 1-3-.7L4 20.5l1.4-4.6a7.4 7.4 0 0 1-.9-3.6 7.6 7.6 0 0 1 7.7-7.6 7.6 7.6 0 0 1 8.3 7.5z" />
  </Svg>
);

// ── Acciones ────────────────────────────────────────────────────

export const IconoMas = (p: Props) => (
  <Svg {...p}><path d="M12 5.5v13M5.5 12h13" /></Svg>
);

export const IconoDescargar = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3.5v11" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M4 18.5v.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-.5" />
  </Svg>
);

export const IconoEnlace = (p: Props) => (
  <Svg {...p}>
    <path d="M13.5 4.5H19.5V10.5" />
    <path d="M19.5 4.5 11 13" />
    <path d="M18 14.5v4a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Svg>
);

export const IconoLlave = (p: Props) => (
  <Svg {...p}>
    <circle cx="7.8" cy="16.2" r="3.3" />
    <path d="m10.2 13.8 8-8" />
    <path d="m15.5 8.5 2 2M18 6l2.2 2.2" />
  </Svg>
);

export const IconoSalir = (p: Props) => (
  <Svg {...p}>
    <path d="M9.5 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.5" />
    <path d="M16 16.5 20.5 12 16 7.5" />
    <path d="M20 12H9.5" />
  </Svg>
);

export const IconoEditar = (p: Props) => (
  <Svg {...p}>
    <path d="M14.7 4.8 19.2 9.3 8 20.5H3.5V16z" />
    <path d="M12.9 6.6 17.4 11.1" />
  </Svg>
);

export const IconoBasura = (p: Props) => (
  <Svg {...p}>
    <path d="M4 6.5h16M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
    <path d="M6.5 6.5 7.4 19a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9l.9-12.5" />
  </Svg>
);

export const IconoAtras = (p: Props) => (
  <Svg {...p}><path d="M14.5 5.5 8 12l6.5 6.5" /></Svg>
);

/**
 * Chevron orientable. `abierto` lo voltea hacia arriba (desplegables) y
 * `direccion` lo gira para usarlo como indicador de avance en una fila.
 */
export const IconoChevron = ({ abierto, direccion = "abajo", ...p }:
  Props & { abierto?: boolean; direccion?: "abajo" | "derecha" }) => (
  <Svg {...p}>
    <path d={
      direccion === "derecha" ? "M9.5 5.5 16 12l-6.5 6.5"
        : abierto ? "M6 14.5 12 8.5l6 6"
        : "M6 9.5l6 6 6-6"
    } />
  </Svg>
);

/** Marca de la extracción con IA. */
export const IconoIA = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3.2 13.7 8 18.5 9.7 13.7 11.4 12 16.2 10.3 11.4 5.5 9.7 10.3 8z" />
    <path d="M18.2 15.5 19 17.7l2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  </Svg>
);

// ── Mapa por clave, para la navegación ──────────────────────────

export const ICONOS_SECCION: Record<string, (p: Props) => React.ReactElement> = {
  memos: IconoMemos,
  administrar: IconoAdministrar,
  revisar: IconoRevisar,
  contabilidad: IconoContabilidad,
  tablero: IconoTablero,
  sistema: IconoSistema,
};
