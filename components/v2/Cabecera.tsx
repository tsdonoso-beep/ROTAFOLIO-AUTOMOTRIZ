"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "../Logo";
import Buscador from "./Buscador";
import ApiKeyConfig from "../ApiKeyConfig";
import { ICONOS_SECCION, IconoSalir } from "./Iconos";
import { clienteNavegador } from "@/lib/supabase/cliente";
import { NOMBRE_ROL, seccionesDe } from "@/lib/dominio/navegacion";
import type { Rol } from "@/lib/dominio/tipos";

interface Props {
  nombre: string;
  roles: Rol[];
  onApiKey?: (k: string) => void;
}

export default function Cabecera({ nombre, roles, onApiKey }: Props) {
  const router = useRouter();
  const ruta = usePathname();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const secciones = seccionesDe(roles);
  const iniciales = nombre.split(" ").filter(Boolean).slice(0, 2)
    .map(p => p[0]).join("").toUpperCase();

  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    if (menu) {
      document.addEventListener("mousedown", fuera);
      document.addEventListener("keydown", escape);
    }
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);

  const salir = async () => {
    await clienteNavegador().auth.signOut();
    router.push("/ingresar");
    router.refresh();
  };

  const esActiva = (r: string) => ruta === r || ruta.startsWith(r + "/");

  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 30,
      background: "rgba(255,255,255,0.88)",
      backdropFilter: "saturate(180%) blur(12px)",
      WebkitBackdropFilter: "saturate(180%) blur(12px)",
      borderBottom: "1px solid var(--border)",
    }}>
      <div style={{
        maxWidth: 1140, margin: "0 auto",
        display: "flex", alignItems: "center", gap: 14,
        padding: "13px 22px",
      }}>
        {/*
          Jerarquía deliberada: el logo de Roland Print es la marca ancla y
          lleva el peso visual. "INRO VIATICOS" es el nombre del módulo
          dentro de esa marca, así que va más chico y en el color de acento.
        */}
        <Link href="/" style={{
          display: "flex", alignItems: "center", gap: 12, flexShrink: 0, textDecoration: "none",
        }}>
          <Logo height={26} />
          <span style={{ width: 1, height: 24, background: "var(--border2)", flexShrink: 0 }} />
          <span className="font-display hidden sm:inline" style={{
            fontSize: 11.5, fontWeight: 700, color: "var(--accent-texto)",
            letterSpacing: "0.045em",
          }}>
            INRO VIATICOS
          </span>
        </Link>

        <Buscador />

        {/* Navegación — en móvil pasa a la fila de abajo.
            Con diez secciones la fila ya no cabe, así que se muestran las
            cinco primeras —que son las del trabajo diario— y el resto va a
            un menú. El orden lo decide navegacion.ts, que es el del proceso. */}
        <nav className="hidden lg:flex" style={{ gap: 2, marginLeft: 6 }}>
          {secciones.slice(0, LAS_QUE_CABEN).map(s => {
            const activa = esActiva(s.ruta);
            const Icono = ICONOS_SECCION[s.clave];
            return (
              <Link key={s.clave} href={s.ruta}
                aria-current={activa ? "page" : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  padding: "8px 13px", borderRadius: "var(--radio-s)",
                  fontSize: 13.5, fontWeight: 600, textDecoration: "none",
                  fontFamily: "var(--font-sora), sans-serif",
                  background: activa ? "var(--accent-suave)" : "transparent",
                  color: activa ? "var(--accent-texto)" : "var(--text2)",
                  transition: "background var(--rapido) var(--curva), color var(--rapido) var(--curva)",
                }}>
                {Icono && <Icono size={16} />}
                {s.etiqueta}
              </Link>
            );
          })}

          {secciones.length > LAS_QUE_CABEN && (
            <MenuDeSecciones
              secciones={secciones.slice(LAS_QUE_CABEN)}
              activa={secciones.slice(LAS_QUE_CABEN).some(x => esActiva(x.ruta))}
            />
          )}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9 }}>
          {/*
            ApiKeyConfig se guarda sola en localStorage (lib/apikey.ts) y
            Captura.tsx la relee al vuelo con getApiKey(): no depende de este
            callback para funcionar. Se renderiza siempre.
          */}
          <ApiKeyConfig onChange={onApiKey} />

          <div ref={ref} style={{ position: "relative" }}>
            <button
              onClick={() => setMenu(v => !v)}
              aria-expanded={menu}
              aria-haspopup="menu"
              aria-label={`Cuenta de ${nombre}`}
              style={{
                display: "flex", alignItems: "center", gap: 2,
                padding: 3, borderRadius: 999,
                border: `1px solid ${menu ? "var(--border2)" : "transparent"}`,
                background: menu ? "var(--surface2)" : "transparent",
                cursor: "pointer",
                transition: "background var(--rapido) var(--curva)",
              }}
            >
              <span style={{
                width: 30, height: 30, borderRadius: 999,
                background: "var(--accent)", color: "#FFFFFF",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, letterSpacing: "0.02em",
                fontFamily: "var(--font-sora), sans-serif",
              }}>
                {iniciales}
              </span>
            </button>

            {menu && (
              <div role="menu" className="animate-fadein" style={{
                position: "absolute", right: 0, top: "calc(100% + 10px)",
                zIndex: 50, width: 268,
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: "var(--radio)", padding: 16,
                boxShadow: "var(--sombra3)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <span style={{
                    width: 38, height: 38, borderRadius: 999, flexShrink: 0,
                    background: "var(--accent)", color: "#FFFFFF",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 700,
                    fontFamily: "var(--font-sora), sans-serif",
                  }}>
                    {iniciales}
                  </span>
                  <p className="font-display" style={{
                    fontSize: 14.5, fontWeight: 700, color: "var(--text)",
                    letterSpacing: "-0.01em", lineHeight: 1.3,
                  }}>
                    {nombre}
                  </p>
                </div>

                <div style={{ marginTop: 13, display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {roles.map(r => (
                    <span key={r} className="badge badge-neutro sin-punto" style={{ fontSize: 10 }}>
                      {NOMBRE_ROL[r]}
                    </span>
                  ))}
                </div>

                <button className="btn-ghost" onClick={salir}
                  style={{ width: "100%", marginTop: 15, justifyContent: "center" }}>
                  <IconoSalir size={16} />
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Navegación móvil */}
      {secciones.length > 1 && (
        <nav className="flex md:hidden" style={{
          gap: 6, padding: "0 14px 11px", overflowX: "auto",
          WebkitOverflowScrolling: "touch", scrollbarWidth: "none",
        }}>
          {secciones.map(s => {
            const activa = esActiva(s.ruta);
            const Icono = ICONOS_SECCION[s.clave];
            return (
              <Link key={s.clave} href={s.ruta}
                aria-current={activa ? "page" : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 13px", borderRadius: 999, whiteSpace: "nowrap",
                  fontSize: 12.5, fontWeight: 600, textDecoration: "none",
                  fontFamily: "var(--font-sora), sans-serif",
                  background: activa ? "var(--accent)" : "var(--surface)",
                  color: activa ? "#FFFFFF" : "var(--text2)",
                  border: `1px solid ${activa ? "var(--accent)" : "var(--border2)"}`,
                }}>
                {Icono && <Icono size={15} />}
                {s.etiqueta}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}

/**
 * Las secciones que no caben en la fila.
 *
 * Con diez secciones la barra crece hasta empujar el buscador fuera de la
 * pantalla. Las del trabajo diario quedan a la vista y el resto vive acá:
 * son las que se visitan una vez por semana, no cada hora.
 */
const LAS_QUE_CABEN = 5;

function MenuDeSecciones({ secciones, activa }: {
  secciones: Array<{ clave: string; etiqueta: string; ruta: string; resumen: string }>;
  activa: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, []);

  return (
    <div ref={caja} style={{ position: "relative" }}>
      <button onClick={() => setAbierto(v => !v)} aria-expanded={abierto} aria-haspopup="menu"
        style={{
          display: "flex", alignItems: "center", gap: 5, padding: "8px 12px",
          borderRadius: "var(--radio-s)", border: "none", cursor: "pointer",
          fontFamily: "var(--font-sora), sans-serif", fontSize: 13.5, fontWeight: 600,
          background: abierto || activa ? "var(--accent-suave)" : "transparent",
          color: abierto || activa ? "var(--accent-texto)" : "var(--text2)",
        }}>
        Más
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={abierto ? "M6 14.5 12 8.5l6 6" : "M6 9.5l6 6 6-6"} />
        </svg>
      </button>

      {abierto && (
        <div role="menu" style={{
          position: "absolute", top: "calc(100% + 7px)", right: 0, zIndex: 60, width: 268,
          background: "var(--surface)", border: "1px solid var(--border2)",
          borderRadius: "var(--radio)", boxShadow: "var(--sombra3)", overflow: "hidden",
        }}>
          {secciones.map(s => {
            const Icono = ICONOS_SECCION[s.clave];
            return (
              <Link key={s.clave} href={s.ruta} role="menuitem"
                onClick={() => setAbierto(false)}
                style={{
                  display: "flex", gap: 10, padding: "11px 14px", textDecoration: "none",
                  borderBottom: "1px solid var(--border)", alignItems: "flex-start",
                }}>
                {Icono && (
                  <span style={{ color: "var(--text3)", marginTop: 2 }}>
                    <Icono size={16} />
                  </span>
                )}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="font-display" style={{
                    display: "block", fontSize: 13, fontWeight: 600, color: "var(--text)",
                  }}>
                    {s.etiqueta}
                  </span>
                  <span style={{
                    display: "block", fontSize: 11.5, color: "var(--text3)",
                    marginTop: 2, lineHeight: 1.4,
                  }}>
                    {s.resumen}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
