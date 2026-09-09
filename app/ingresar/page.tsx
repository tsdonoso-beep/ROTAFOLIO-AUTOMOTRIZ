"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { clienteNavegador } from "@/lib/supabase/cliente";
import Logo from "@/components/Logo";
import { Aviso } from "@/components/v2/Encabezado";
import { IconoAlerta } from "@/components/v2/Iconos";

export default function Ingresar() {
  const router = useRouter();
  const [identificador, setIdentificador] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    setError("");

    const sb = clienteNavegador();

    // Se entra con documento o con correo, indistintamente. Buena parte del
    // personal no tiene cuenta de correo, así que el documento es el camino
    // principal: el servidor traduce lo tecleado al correo con el que la
    // cuenta existe realmente, que para esas personas es uno sintético.
    const { data: correo, error: errRpc } = await sb.rpc("correo_de_acceso", {
      identificador: identificador.trim(),
    });

    if (errRpc || typeof correo !== "string") {
      setError("No se pudo verificar tus datos. Revisa tu conexión e inténtalo de nuevo.");
      setCargando(false);
      return;
    }

    const { error: err } = await sb.auth.signInWithPassword({
      email: correo,
      password: clave,
    });

    if (err) {
      // No se distingue "no existe" de "clave incorrecta": decirlo permitiría
      // averiguar qué documentos están dados de alta probando números.
      setError("Documento, correo o contraseña incorrectos.");
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

        <label className="fg-label">DNI o correo</label>
        <input
          className="fg-input" type="text" autoComplete="username"
          inputMode={identificador.includes("@") ? "email" : "numeric"}
          value={identificador} onChange={e => setIdentificador(e.target.value)}
          placeholder="12345678" required autoFocus
          style={{ marginBottom: 4 }}
        />
        <p style={{
          fontSize: 11, color: "var(--text3)", lineHeight: 1.45, marginBottom: 14,
        }}>
          Si no tienes correo de la empresa, entra con tu número de documento.
        </p>

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
          type="submit" className="btn-primary" disabled={cargando || !identificador || !clave}
          style={{ width: "100%", justifyContent: "center", marginTop: 20, padding: 12 }}
        >
          {cargando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
