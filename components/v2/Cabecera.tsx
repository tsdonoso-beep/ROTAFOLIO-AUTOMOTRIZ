"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "../Logo";
import ApiKeyConfig from "../ApiKeyConfig";
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
    if (menu) document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [menu]);

  const salir = async () => {
    await clienteNavegador().auth.signOut();
    router.push("/ingresar");
    router.refresh();
  };

  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 30,
      background: "#FFFFFF",
      borderBottom: "1px solid var(--border)",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    }}>
      <div style={{
        maxWidth: 1100, margin: "0 auto",
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 20px",
      }}>
        <Link href="/" style={{ display: "flex", flexShrink: 0 }}>
          <Logo height={22} />
        </Link>

        {/* Navegación — se oculta en móvil, donde va abajo */}
        <nav className="hidden md:flex" style={{ gap: 2, marginLeft: 12, flex: 1 }}>
          {secciones.map(s => {
            const activa = ruta === s.ruta || ruta.startsWith(s.ruta + "/");
            return (
              <Link key={s.clave} href={s.ruta} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 12px", borderRadius: 8,
                fontSize: 13, fontWeight: 600, textDecoration: "none",
                fontFamily: "var(--font-sora), sans-serif",
                background: activa ? "var(--surface2)" : "transparent",
                color: activa ? "var(--text)" : "var(--text2)",
                border: `1px solid ${activa ? "var(--border2)" : "transparent"}`,
                transition: "all 0.15s",
              }}>
                <span style={{ fontSize: 13 }}>{s.icono}</span>
                {s.etiqueta}
              </Link>
            );
          })}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {onApiKey && <ApiKeyConfig onChange={onApiKey} />}

          <div ref={ref} style={{ position: "relative" }}>
            <button
              onClick={() => setMenu(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "4px 10px 4px 4px", borderRadius: 999,
                border: "1px solid var(--border2)", background: "#FFFFFF",
                cursor: "pointer",
              }}
            >
              <span style={{
                width: 26, height: 26, borderRadius: "50%",
                background: "var(--accent)", color: "#FFFFFF",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 700,
                fontFamily: "var(--font-sora), sans-serif",
              }}>
                {iniciales}
              </span>
              <span style={{ fontSize: 11, color: "var(--text3)" }}>▾</span>
            </button>

            {menu && (
              <div className="animate-fadein" style={{
                position: "absolute", right: 0, top: "calc(100% + 8px)",
                zIndex: 50, width: 250,
                background: "#FFFFFF", border: "1px solid var(--border2)",
                borderRadius: 12, padding: 14,
                boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
              }}>
                <p className="font-display" style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                  {nombre}
                </p>
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {roles.map(r => (
                    <span key={r} style={{
                      fontSize: 10, fontWeight: 600, padding: "2px 7px",
                      borderRadius: 999, background: "var(--surface2)",
                      color: "var(--text2)", border: "1px solid var(--border)",
                      fontFamily: "var(--font-sora), sans-serif",
                    }}>
                      {NOMBRE_ROL[r]}
                    </span>
                  ))}
                </div>
                <button className="btn-ghost" onClick={salir}
                  style={{ width: "100%", marginTop: 14, justifyContent: "center" }}>
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
          gap: 4, padding: "0 12px 10px", overflowX: "auto",
          WebkitOverflowScrolling: "touch",
        }}>
          {secciones.map(s => {
            const activa = ruta === s.ruta || ruta.startsWith(s.ruta + "/");
            return (
              <Link key={s.clave} href={s.ruta} style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "6px 11px", borderRadius: 8, whiteSpace: "nowrap",
                fontSize: 12, fontWeight: 600, textDecoration: "none",
                fontFamily: "var(--font-sora), sans-serif",
                background: activa ? "var(--accent)" : "var(--surface2)",
                color: activa ? "#FFFFFF" : "var(--text2)",
                border: "1px solid var(--border)",
              }}>
                <span>{s.icono}</span>
                {s.etiqueta}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
