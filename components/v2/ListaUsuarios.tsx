"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Aviso, Tarjeta } from "./Encabezado";
import { IconoAlerta, IconoCheck } from "./Iconos";
import { asignarJefatura } from "@/app/acciones/usuarios";
import { NOMBRE_ROL } from "@/lib/dominio/navegacion";
import type { Rol } from "@/lib/dominio/tipos";

export interface UsuarioFila {
  id: string;
  nombre: string;
  dni: string;
  dni_provisional: boolean;
  email: string | null;
  activo: boolean;
  jefatura_id: string | null;
  roles: Rol[];
}

/**
 * Usuarios, sus roles y de quién dependen.
 *
 * La jefatura no es decorativa: las políticas de fila la usan para decidir
 * qué ve cada líder en su tablero. Cambiarla acá cambia el alcance de esa
 * persona en el acto.
 */
export default function ListaUsuarios({ usuarios }: { usuarios: UsuarioFila[] }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [aviso, setAviso] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);

  const cambiar = (usuarioId: string, jefaturaId: string | null) => {
    iniciar(async () => {
      const r = await asignarJefatura(usuarioId, jefaturaId);
      if (r.ok) {
        setAviso({ tono: "ok", texto: "Jefatura actualizada." });
        router.refresh();
      } else {
        setAviso({ tono: "error", texto: r.error });
      }
    });
  };

  // Solo puede ser jefatura quien tiene el rol: si no, no vería el tablero
  // y la asignación no serviría de nada.
  const posiblesLideres = usuarios.filter(u => u.activo && u.roles.includes("JEFATURA"));

  return (
    <>
      {aviso && (
        <div style={{ marginBottom: 10 }}>
          <Aviso
            tono={aviso.tono}
            icono={aviso.tono === "ok" ? <IconoCheck size={16} /> : <IconoAlerta size={16} />}
          >
            {aviso.texto}
          </Aviso>
        </div>
      )}

      <Tarjeta padding={0}>
        {usuarios.map((u, i, arr) => (
          <div key={u.id} style={{
            padding: "13px 16px",
            borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
          }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 190 }}>
                <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>
                  {u.nombre}
                  {!u.activo && (
                    <span style={{ marginLeft: 7, fontSize: 11, color: "var(--text3)" }}>(inactivo)</span>
                  )}
                </p>
                <p style={{
                  fontSize: 11.5, color: "var(--text3)", marginTop: 2,
                  display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
                }}>
                  <span className="mono">{u.dni}</span>
                  {u.dni_provisional && (
                    <span className="badge badge-warn" style={{ fontSize: 9 }}>provisional</span>
                  )}
                  {u.email
                    ? <span>· {u.email}</span>
                    : <span style={{ fontStyle: "italic" }}>· sin correo</span>}
                </p>
              </div>

              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {u.roles.map(rol => (
                  <span key={rol} style={{
                    fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 999,
                    background: "var(--surface2)", color: "var(--text2)",
                    border: "1px solid var(--border)",
                    fontFamily: "var(--font-sora), sans-serif",
                  }}>
                    {NOMBRE_ROL[rol]}
                  </span>
                ))}
              </div>
            </div>

            <div style={{
              marginTop: 9, display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap",
            }}>
              <label className="rotulo" style={{ marginBottom: 0 }} htmlFor={`jefe-${u.id}`}>
                Reporta a
              </label>
              <select
                id={`jefe-${u.id}`}
                className="fg-input"
                value={u.jefatura_id ?? ""}
                disabled={pendiente}
                onChange={e => cambiar(u.id, e.target.value || null)}
                style={{
                  flex: 1, minWidth: 200, maxWidth: 320, padding: "7px 10px", fontSize: 12.5,
                  fontFamily: "var(--font-dm), sans-serif",
                }}
              >
                <option value="">— nadie —</option>
                {posiblesLideres
                  .filter(l => l.id !== u.id)
                  .map(l => (
                    <option key={l.id} value={l.id}>{l.nombre}</option>
                  ))}
              </select>
            </div>
          </div>
        ))}
      </Tarjeta>

      {!posiblesLideres.length && (
        <p style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 8, lineHeight: 1.5 }}>
          Nadie tiene el rol de Jefatura todavía, así que no hay a quién asignar.
        </p>
      )}
    </>
  );
}
