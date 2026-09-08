"use client";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clienteNavegador } from "@/lib/supabase/cliente";
import { Aviso } from "./Encabezado";
import { IconoAlerta, IconoCamara, IconoGaleria } from "./Iconos";
import { getApiKey } from "@/lib/apikey";
import { validarGasto } from "@/lib/dominio/validaciones";
import type { Alerta, Parametros, ResultadoExtraccion } from "@/lib/dominio/tipos";

const MAX_LADO = 1800;
const CALIDAD = 0.82;

interface Props {
  memoId: string;
  parametros: Parametros;
  memo: { monto_autorizado: number; fecha_salida: string | null; fecha_retorno_prev: string | null };
  rendidoPrevio: number;
  onListo: () => void;
}

type Paso = "reposo" | "comprimiendo" | "extrayendo" | "guardando";

export default function Captura({ memoId, parametros, memo, rendidoPrevio, onListo }: Props) {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>("reposo");
  const [progreso, setProgreso] = useState("");
  const [error, setError] = useState("");
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);

  const procesar = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setError("");

    const clave = getApiKey();
    if (!clave) {
      setError("Configura tu clave de IA con el botón de la llave, arriba a la derecha, antes de capturar.");
      return;
    }

    const sb = clienteNavegador();
    const total = files.length;

    for (let i = 0; i < total; i++) {
      const file = files[i];
      const etiqueta = total > 1 ? ` (${i + 1} de ${total})` : "";

      try {
        setPaso("comprimiendo");
        setProgreso(`Preparando imagen${etiqueta}…`);
        const { base64, mimeType, hash } = await prepararArchivo(file);

        setPaso("extrayendo");
        setProgreso(`Leyendo el comprobante con IA${etiqueta}…`);
        const res = await fetch("/api/extraer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64, mimeType, apiKey: clave }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "No se pudo leer el comprobante.");

        const r = json.resultado as ResultadoExtraccion;

        setPaso("guardando");
        setProgreso(`Guardando${etiqueta}…`);

        // Los duplicados se comprueban contra lo que ya existe, antes de
        // insertar: la base también los rechaza, pero así el mensaje es claro.
        const dup = await buscarDuplicados(sb, hash, r);

        const alertas: Alerta[] = validarGasto(
          {
            clase: "COMPROBANTE",
            proveedor_ruc: r.proveedor_ruc,
            tipo_comprobante: r.tipo_comprobante,
            fecha_emision: r.fecha_emision,
            subtotal: r.subtotal, igv: r.igv, total: r.total,
            confianza_extraccion: r._confianza,
          },
          {
            parametros,
            memo: {
              monto_autorizado: memo.monto_autorizado,
              fecha_salida: memo.fecha_salida,
              fecha_retorno_prev: memo.fecha_retorno_prev,
              rendido_previo: rendidoPrevio,
            },
            duplicadoComprobante: dup.comprobante,
            duplicadoImagen: dup.imagen,
          }
        );

        const { data: usuario } = await sb.auth.getUser();
        const { data: fila } = await sb.from("usuarios")
          .select("id").eq("auth_id", usuario.user!.id).single();

        const { error: errIns } = await sb.from("gastos").insert({
          // Generado en el dispositivo: hace idempotente el reintento.
          client_id: crypto.randomUUID(),
          memo_id: memoId,
          usuario_id: fila!.id,
          estado: alertas.length ? "CON_ALERTA" : "VALIDADO",
          clase: "COMPROBANTE",
          proveedor_ruc: r.proveedor_ruc || null,
          proveedor_nombre: r.proveedor_nombre || null,
          tipo_comprobante: r.tipo_comprobante || null,
          serie: r.serie || null,
          numero: r.numero || null,
          fecha_emision: r.fecha_emision || null,
          moneda: r.moneda,
          subtotal: r.subtotal, igv: r.igv, total: r.total,
          forma_pago: r.forma_pago || null,
          detalle: r.detalle || null,
          confianza_extraccion: r._confianza,
          alertas,
          hash_imagen: hash,
          capturado_en: new Date().toISOString(),
          sincronizado_en: new Date().toISOString(),
        });

        if (errIns) {
          // La base tiene índices únicos parciales: es la última barrera
          // contra la duplicidad, aunque la comprobación previa falle.
          throw new Error(
            /duplicate key|unique/i.test(errIns.message)
              ? "Este comprobante ya fue cargado antes."
              : errIns.message
          );
        }
      } catch (e) {
        setError((e as Error).message);
        setPaso("reposo");
        setProgreso("");
        return;
      }
    }

    setPaso("reposo");
    setProgreso("");
    onListo();
    router.refresh();
  }, [memoId, parametros, memo, rendidoPrevio, onListo, router]);

  const ocupado = paso !== "reposo";

  /** Los tres pasos, para que la espera tenga forma y no sea un limbo. */
  const PASOS: Paso[] = ["comprimiendo", "extrayendo", "guardando"];
  const indicePaso = PASOS.indexOf(paso);

  return (
    <div>
      {/*
        La cámara pesa más que la galería: en campo es la acción real, y
        quien está parado frente a un mostrador necesita acertarle sin
        mirar. Ocupa el doble de ancho y lleva el color de marca.
      */}
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={() => camara.current?.click()} disabled={ocupado}
          style={{
            flex: 2, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 9,
            padding: "26px 18px", borderRadius: "var(--radio)",
            cursor: ocupado ? "wait" : "pointer",
            border: "1px solid var(--accent-borde)",
            background: "var(--accent-suave)",
            color: "var(--accent-texto)",
            fontFamily: "var(--font-sora), sans-serif",
            opacity: ocupado ? 0.45 : 1,
            transition: "opacity var(--medio) var(--curva), transform var(--rapido) var(--curva)",
          }}
        >
          <IconoCamara size={30} />
          <span style={{ fontSize: 14, fontWeight: 700 }}>Tomar foto</span>
        </button>

        <button
          onClick={() => galeria.current?.click()} disabled={ocupado}
          style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 9,
            padding: "26px 14px", borderRadius: "var(--radio)",
            cursor: ocupado ? "wait" : "pointer",
            border: "1px solid var(--border2)", background: "var(--surface)",
            color: "var(--text2)", fontFamily: "var(--font-sora), sans-serif",
            opacity: ocupado ? 0.45 : 1,
            transition: "opacity var(--medio) var(--curva), background var(--rapido) var(--curva)",
          }}
        >
          <IconoGaleria size={26} />
          <span style={{ fontSize: 12.5, fontWeight: 600, textAlign: "center" }}>
            Galería<br />o PDF
          </span>
        </button>
      </div>

      {/* Progreso por etapas: se ve qué está pasando y cuánto falta. */}
      {ocupado && (
        <div className="animate-fadein" style={{
          marginTop: 13, padding: "14px 16px", borderRadius: "var(--radio-s)",
          background: "var(--accent-suave)", border: "1px solid var(--accent-borde)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="animate-spin" style={{
              display: "inline-block", width: 15, height: 15, flexShrink: 0,
              border: "2px solid var(--accent)", borderTopColor: "transparent",
              borderRadius: "50%",
            }} />
            <p style={{
              fontSize: 13.5, color: "var(--accent-texto)", fontWeight: 600,
              fontFamily: "var(--font-sora), sans-serif",
            }}>
              {progreso}
            </p>
          </div>

          <div style={{ display: "flex", gap: 5, marginTop: 12 }}>
            {PASOS.map((p, i) => (
              <span key={p} style={{
                flex: 1, height: 3, borderRadius: 999,
                background: i <= indicePaso ? "var(--accent)" : "var(--accent-borde)",
                opacity: i === indicePaso ? 1 : i < indicePaso ? 0.75 : 0.4,
                transition: "background var(--medio) var(--curva), opacity var(--medio) var(--curva)",
              }} />
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="animate-fadein" style={{ marginTop: 13 }}>
          <Aviso tono="error" icono={<IconoAlerta size={17} />}>{error}</Aviso>
        </div>
      )}

      <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { procesar(e.target.files); e.target.value = ""; }} />
      <input ref={galeria} type="file" accept="image/*,application/pdf" multiple className="hidden"
        onChange={e => { procesar(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════

async function buscarDuplicados(
  sb: ReturnType<typeof clienteNavegador>,
  hash: string,
  r: ResultadoExtraccion
): Promise<{ comprobante: boolean; imagen: boolean }> {
  const { data: porImagen } = await sb
    .from("gastos").select("id").eq("hash_imagen", hash).limit(1);

  let comprobante = false;
  if (r.proveedor_ruc && r.serie && r.numero) {
    const { data } = await sb
      .from("gastos").select("id")
      .eq("proveedor_ruc", r.proveedor_ruc)
      .eq("serie", r.serie)
      .eq("numero", r.numero)
      .limit(1);
    comprobante = !!data?.length;
  }

  return { comprobante, imagen: !!porImagen?.length };
}

/**
 * Reduce la imagen y calcula su huella.
 *
 * Una foto de teléfono pesa 4-6 MB y en base64 crece un 33% más: la IA la
 * rechaza o tarda demasiado. A 1800 px y calidad 82% baja a ~300 KB sin
 * perder legibilidad. Los PDF se dejan intactos.
 */
async function prepararArchivo(file: File): Promise<{ base64: string; mimeType: string; hash: string }> {
  const original = await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });

  let dataUrl = original;
  let mimeType = file.type || "image/jpeg";

  if (file.type.startsWith("image/")) {
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const el = new Image();
        el.onload = () => res(el);
        el.onerror = () => rej(new Error("no-decodable"));
        el.src = original;
      });

      const escala = Math.min(1, MAX_LADO / Math.max(img.width, img.height));
      if (escala < 1 || file.size >= 900_000) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Fondo blanco: un PNG con transparencia saldría negro en JPEG.
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          dataUrl = canvas.toDataURL("image/jpeg", CALIDAD);
          mimeType = "image/jpeg";
        }
      }
    } catch {
      // Si no se puede comprimir se envía la original.
    }
  }

  const base64 = dataUrl.split(",")[1];
  return { base64, mimeType, hash: await sha256(base64) };
}

async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
