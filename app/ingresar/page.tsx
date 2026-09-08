"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { clienteNavegador } from "@/lib/supabase/cliente";
import Logo from "@/components/Logo";
import { Aviso } from "@/components/v2/Encabezado";
import { IconoAlerta } from "@/components/v2/Iconos";

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
    /*
      Un halo del verde de marca detrás de la tarjeta: da profundidad a una
      pantalla que, por definición, no tiene contenido que mostrar todavía.
    */
    <div style={{
      minHeight: "100dvh", display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20,
      background:
        "radial-gradient(700px 420px at 50% -8%, var(--accent-suave), transparent 70%), var(--fondo)",
    }}>
      <form onSubmit={entrar} className="animate-fadein" style={{
        width: "100%", maxWidth: 380,
        background: "#FFFFFF",
        border: "1px solid var(--border)",
        borderRadius: "var(--radio-l)",
        padding: "34px 28px",
        boxShadow: "var(--sombra3)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <Logo height={26} />
        </div>

        <p className="font-display" style={{
          fontSize: 21, fontWeight: 800, color: "var(--text)",
          letterSpacing: "-0.025em", textAlign: "center", marginBottom: 5,
        }}>
          INRO VIATICOS
        </p>
        <p className="rotulo" style={{ textAlign: "center" }}>
          Rendición de viáticos y gastos
        </p>
        <p style={{
          fontSize: 13, color: "var(--text2)", textAlign: "center",
          marginTop: 14, marginBottom: 26, lineHeight: 1.5,
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
          <div className="animate-fadein" style={{ marginTop: 14 }}>
            <Aviso tono="error" icono={<IconoAlerta size={17} />}>{error}</Aviso>
          </div>
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
