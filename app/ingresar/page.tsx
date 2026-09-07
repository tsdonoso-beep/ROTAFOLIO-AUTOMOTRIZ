"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { clienteNavegador } from "@/lib/supabase/cliente";
import Logo from "@/components/Logo";

export default function Ingresar() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    setError("");

    const sb = clienteNavegador();
    const { error: err } = await sb.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: clave,
    });

    if (err) {
      // No se distingue "usuario inexistente" de "clave incorrecta": decirlo
      // permitiría averiguar qué correos están dados de alta.
      setError("Correo o contraseña incorrectos.");
      setCargando(false);
      return;
    }

    router.push("/");
    router.refresh();
  };

  return (
    <div style={{
      minHeight: "100dvh", display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <form onSubmit={entrar} className="animate-fadein" style={{
        width: "100%", maxWidth: 380,
        background: "#FFFFFF",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: "32px 28px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <Logo height={26} />
        </div>

        <p className="font-display" style={{
          fontSize: 17, fontWeight: 800, color: "var(--text)",
          letterSpacing: "-0.02em", textAlign: "center", marginBottom: 4,
        }}>
          Rendición de Gastos
        </p>
        <p style={{
          fontSize: 13, color: "var(--text2)", textAlign: "center",
          marginBottom: 26, lineHeight: 1.5,
        }}>
          Ingresa con tu cuenta para continuar
        </p>

        <label className="fg-label">Correo</label>
        <input
          className="fg-input" type="email" autoComplete="username"
          value={email} onChange={e => setEmail(e.target.value)}
          placeholder="tu.correo@empresa.com" required autoFocus
          style={{ marginBottom: 14 }}
        />

        <label className="fg-label">Contraseña</label>
        <input
          className="fg-input" type="password" autoComplete="current-password"
          value={clave} onChange={e => setClave(e.target.value)}
          placeholder="••••••••" required
        />

        {error && (
          <p style={{ marginTop: 12, fontSize: 12, color: "var(--danger)", textAlign: "center" }}>
            {error}
          </p>
        )}

        <button
          type="submit" className="btn-primary" disabled={cargando || !email || !clave}
          style={{ width: "100%", justifyContent: "center", marginTop: 20, padding: 12 }}
        >
          {cargando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
