"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clienteNavegador } from "@/lib/supabase/cliente";
import { Aviso, Tarjeta, soles } from "./Encabezado";
import {
  IconoAlerta, IconoAtras, IconoCamara, IconoCheck,
  IconoComprobante, IconoGaleria, IconoIA, IconoLlave,
} from "./Iconos";
import FormularioGasto from "./FormularioGasto";
import { getApiKey } from "@/lib/apikey";
import { leerImagen, esLegiblePorOcr, cerrarMotor } from "@/lib/ocr/motor";
import { parsearComprobante } from "@/lib/ocr/parser";
import {
  camposPendientes, fusionar, sustentoFaltante, vacio, type Origen,
} from "@/lib/ocr/fusion";
import { validarGasto } from "@/lib/dominio/validaciones";
import type { Alerta, Parametros, ResultadoExtraccion } from "@/lib/dominio/tipos";

const MAX_LADO = 1800;
const CALIDAD = 0.82;

/** Nombres legibles de los campos, para decir qué falta. */
const NOMBRE_CAMPO: Record<string, string> = {
  proveedor_ruc: "RUC",
  proveedor_nombre: "razón social",
  serie: "serie",
  numero: "número",
  fecha_emision: "fecha",
  total: "total",
};

interface Props {
  memoId: string;
  parametros: Parametros;
  memo: { monto_autorizado: number; fecha_salida: string | null; fecha_retorno_prev: string | null };
  /** Datos para archivar la foto en Drive y descartar el RUC propio. */
  contexto: {
    empresaAbrev: string;
    empresaRuc: string | null;
    centroCostoFolder: string;
    correlativo: string;
  };
  rendidoPrevio: number;
  onListo: () => void;
}

type Fase = "reposo" | "preparando" | "ocr" | "ia" | "revision" | "guardando";

/** Una imagen ya preparada, esperando confirmación. */
interface Preparada {
  dataUrl: string;
  base64: string;
  mimeType: string;
  hash: string;
}

export default function Captura({
  memoId, parametros, memo, contexto, rendidoPrevio, onListo,
}: Props) {
  const router = useRouter();
  const [fase, setFase] = useState<Fase>("reposo");
  const [progreso, setProgreso] = useState("");
  const [fraccion, setFraccion] = useState(0);
  const [error, setError] = useState("");
  const [nota, setNota] = useState("");

  // Lo que se está confirmando: la imagen (si hubo) y los valores.
  const [imagen, setImagen] = useState<Preparada | null>(null);
  const [valores, setValores] = useState<ResultadoExtraccion>(vacio());
  const [origen, setOrigen] = useState<Record<string, Origen>>({});

  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);

  // El worker de OCR ocupa memoria; se suelta al dejar la pantalla.
  useEffect(() => () => { void cerrarMotor(); }, []);

  // ── Lectura: OCR primero, IA solo para lo que quedó pendiente ──
  const procesar = useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    setError("");
    setNota("");

    try {
      setFase("preparando");
      setProgreso("Preparando la imagen…");
      const preparada = await prepararArchivo(file);
      setImagen(preparada);

      // ── 1. OCR local: gratis, sin cuota y sin salir del teléfono ──
      let lecturaOcr: ResultadoExtraccion | null = null;
      if (esLegiblePorOcr(preparada.mimeType)) {
        setFase("ocr");
        setFraccion(0);
        setProgreso("Leyendo el comprobante en el dispositivo…");
        try {
          const { texto } = await leerImagen(preparada.dataUrl, setFraccion);
          lecturaOcr = parsearComprobante(texto, {
            rucPropio: contexto.empresaRuc,
            igvPorcentaje: parametros.igv_porcentaje,
          });
        } catch {
          // El OCR es un intento, no un requisito: si falla se sigue.
          setNota("No se pudo leer con el motor local. Revisa los campos a mano.");
        }
      }

      // ── 2. IA: solo si hay clave y si algo quedó sin leer ──
      let lecturaIa: ResultadoExtraccion | null = null;
      const pendientesTrasOcr = lecturaOcr ? camposPendientes(lecturaOcr) : ["todo"];
      const clave = getApiKey();

      if (clave && pendientesTrasOcr.length > 0) {
        setFase("ia");
        setProgreso("Completando con IA lo que faltó…");
        try {
          const res = await fetch("/api/extraer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              base64: preparada.base64, mimeType: preparada.mimeType, apiKey: clave,
            }),
          });
          const json = await res.json();
          if (res.ok) lecturaIa = json.resultado as ResultadoExtraccion;
          else throw new Error(json.error ?? "");
        } catch (e) {
          // Cuota agotada o clave inválida: el OCR ya hizo su parte y la
          // persona completa el resto. La app no se detiene por esto.
          const detalle = (e as Error).message;
          setNota(
            lecturaOcr
              ? `La IA no respondió${detalle ? ` (${detalle})` : ""}. Se usó solo la lectura local.`
              : "La IA no respondió y el motor local no pudo leer. Ingresa los datos a mano."
          );
        }
      } else if (!clave && pendientesTrasOcr.length > 0) {
        setNota("Sin clave de IA configurada: se usó solo la lectura local del dispositivo.");
      }

      const { valores: v, origen: o } = fusionar(lecturaOcr, lecturaIa);

      // Un comprobante suele capturarse el mismo día: es mejor punto de
      // partida que dejar la fecha en blanco, y queda marcada como tuya.
      if (!v.fecha_emision) {
        v.fecha_emision = new Date().toISOString().slice(0, 10);
        o.fecha_emision = "manual";
      }

      setValores(v);
      setOrigen(o);
      setFase("revision");
    } catch (e) {
      setError((e as Error).message);
      setFase("reposo");
    } finally {
      setProgreso("");
      setFraccion(0);
    }
  }, [contexto.empresaRuc, parametros.igv_porcentaje]);

  // ── Carga manual, sin foto ──
  const cargarAMano = () => {
    setError("");
    setNota("");
    setImagen(null);
    const v = vacio();
    v.fecha_emision = new Date().toISOString().slice(0, 10);
    setValores(v);
    setOrigen({ fecha_emision: "manual" });
    setFase("revision");
  };

  const cancelar = () => {
    setFase("reposo");
    setImagen(null);
    setValores(vacio());
    setOrigen({});
    setError("");
    setNota("");
  };

  // ── Confirmación: recién aquí se guarda y se archiva la foto ──
  const confirmar = useCallback(async () => {
    if (camposPendientes(valores).length) {
      setError("Falta el monto: es lo único sin lo que el gasto no se puede registrar.");
      return;
    }

    setError("");
    setFase("guardando");

    const sb = clienteNavegador();

    try {
      setProgreso("Comprobando duplicados…");
      const dup = await buscarDuplicados(sb, imagen?.hash ?? null, valores);

      const alertas: Alerta[] = validarGasto(
        {
          clase: "COMPROBANTE",
          proveedor_ruc: valores.proveedor_ruc,
          tipo_comprobante: valores.tipo_comprobante,
          fecha_emision: valores.fecha_emision,
          subtotal: valores.subtotal, igv: valores.igv, total: valores.total,
          confianza_extraccion: valores._confianza,
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

      setProgreso("Guardando el gasto…");
      const { data: usuario } = await sb.auth.getUser();
      const { data: fila } = await sb.from("usuarios")
        .select("id").eq("auth_id", usuario.user!.id).single();

      const { data: creado, error: errIns } = await sb.from("gastos").insert({
        // Generado en el dispositivo: hace idempotente el reintento.
        client_id: crypto.randomUUID(),
        memo_id: memoId,
        usuario_id: fila!.id,
        estado: alertas.length ? "CON_ALERTA" : "VALIDADO",
        clase: "COMPROBANTE",
        proveedor_ruc: valores.proveedor_ruc || null,
        proveedor_nombre: valores.proveedor_nombre || null,
        tipo_comprobante: valores.tipo_comprobante || null,
        serie: valores.serie || null,
        numero: valores.numero || null,
        fecha_emision: valores.fecha_emision || null,
        moneda: valores.moneda,
        subtotal: valores.subtotal, igv: valores.igv, total: valores.total,
        forma_pago: valores.forma_pago || null,
        detalle: valores.detalle || null,
        confianza_extraccion: valores._confianza,
        alertas,
        hash_imagen: imagen?.hash ?? null,
        capturado_en: new Date().toISOString(),
        sincronizado_en: new Date().toISOString(),
      }).select("id").single();

      if (errIns) {
        // La base tiene índices únicos parciales: es la última barrera
        // contra la duplicidad, aunque la comprobación previa falle.
        throw new Error(
          /duplicate key|unique/i.test(errIns.message)
            ? "Este comprobante ya fue cargado antes."
            : errIns.message
        );
      }

      // ── Archivo de la foto ──
      //
      // El gasto ya está guardado. La subida a Drive va después y a
      // propósito: si la red falla aquí, el gasto no se pierde — queda
      // anotado el error y se puede reintentar desde el detalle.
      if (imagen && creado) {
        setProgreso("Archivando la foto en Drive…");
        try {
          const nombre = nombreArchivo(valores, imagen.mimeType);
          const res = await fetch("/api/drive-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              base64: imagen.base64,
              mimeType: imagen.mimeType,
              fileName: nombre,
              carpeta1: contexto.centroCostoFolder,
              carpeta2: contexto.correlativo,
            }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? "Error subiendo a Drive");
          await sb.from("gastos").update({ drive_url: json.url, storage_key: json.id })
            .eq("id", creado.id);
        } catch (e) {
          await sb.from("gastos").update({ drive_error: (e as Error).message })
            .eq("id", creado.id);
          setNota(
            "El gasto quedó guardado, pero la foto no llegó a Drive: " +
            (e as Error).message
          );
        }
      }

      cancelar();
      onListo();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setFase("revision");
    } finally {
      setProgreso("");
    }
  }, [
    valores, imagen, memoId, parametros, memo, rendidoPrevio,
    contexto.centroCostoFolder, contexto.correlativo, onListo, router,
  ]);

  // ════════════════════════════════════════════════════════════
  //  Pantalla de confirmación
  // ════════════════════════════════════════════════════════════

  if (fase === "revision" || fase === "guardando") {
    const guardando = fase === "guardando";
    // Solo el monto impide guardar. Lo demás se advierte y sigue.
    const faltaMonto = camposPendientes(valores).length > 0;
    const sinSustento = sustentoFaltante(valores);

    return (
      <div className="animate-fadein">
        <button
          onClick={cancelar} disabled={guardando}
          className="hover-atras"
          style={{
            display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 14,
            background: "none", border: "none", cursor: guardando ? "not-allowed" : "pointer",
            fontSize: 13, color: "var(--text2)", padding: 0,
            fontFamily: "var(--font-dm), sans-serif",
          }}
        >
          <IconoAtras size={15} />
          Descartar y volver
        </button>

        <Tarjeta padding={0} style={{ overflow: "hidden" }}>
          {/* La foto a la vista mientras se revisan los campos: es contra
              ella que la persona está confirmando. */}
          {imagen ? (
            <div style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagen.dataUrl} alt="Comprobante capturado"
                style={{
                  width: "100%", maxHeight: 300, objectFit: "contain",
                  display: "block", padding: 10,
                }}
              />
            </div>
          ) : (
            <div style={{
              padding: "14px 18px", background: "var(--surface2)",
              borderBottom: "1px solid var(--border)",
              display: "flex", alignItems: "center", gap: 9,
            }}>
              <IconoComprobante size={17} />
              <p style={{ fontSize: 12.5, color: "var(--text2)" }}>
                Carga manual, sin foto adjunta.
              </p>
            </div>
          )}

          <div style={{ padding: "18px 18px 20px" }}>
            {nota && (
              <div style={{ marginBottom: 16 }}>
                <Aviso tono="info" icono={<IconoIA size={17} />}>{nota}</Aviso>
              </div>
            )}

            <FormularioGasto
              valores={valores} origen={origen} parametros={parametros}
              onCambio={(v, o) => { setValores(v); setOrigen(o); }}
            />

            {error && (
              <div className="animate-fadein" style={{ marginTop: 16 }}>
                <Aviso tono="error" icono={<IconoAlerta size={17} />}>{error}</Aviso>
              </div>
            )}

            {/* Cierre: lo que se está afirmando, y el botón que lo afirma. */}
            <div style={{
              marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--border)",
            }}>
              {valores.total > 0 && (
                <p style={{
                  fontSize: 12.5, color: "var(--text2)", lineHeight: 1.55, marginBottom: 12,
                }}>
                  {imagen ? "Confirmas que esta es la foto correcta y que el" : "Confirmas que el"}
                  {" "}gasto es de{" "}
                  <strong className="cifra" style={{ color: "var(--text)" }}>
                    {soles(valores.total)}
                  </strong>.
                  {imagen && " Al confirmar, la foto se archiva en Drive."}
                </p>
              )}

              <button
                className="btn-primary" onClick={confirmar}
                disabled={guardando || faltaMonto}
                style={{
                  width: "100%", justifyContent: "center", padding: 14, fontSize: 14,
                  opacity: faltaMonto ? 0.5 : 1,
                  cursor: faltaMonto ? "not-allowed" : "pointer",
                }}
              >
                {guardando ? (progreso || "Guardando…") : (
                  <><IconoCheck size={18} />Confirmar y guardar</>
                )}
              </button>

              {faltaMonto ? (
                <p style={{
                  fontSize: 11.5, color: "var(--text3)", marginTop: 9,
                  textAlign: "center", lineHeight: 1.45,
                }}>
                  Escribe el monto para poder guardar.
                </p>
              ) : sinSustento.length > 0 && (
                /* Se puede guardar: esto informa, no frena. */
                <p style={{
                  fontSize: 11.5, color: "var(--text3)", marginTop: 9,
                  textAlign: "center", lineHeight: 1.45,
                }}>
                  Se guardará sin {sinSustento.map(c => NOMBRE_CAMPO[c] ?? c).join(", ")}.
                  Quedará marcado como gasto sin sustento formal.
                </p>
              )}
            </div>
          </div>
        </Tarjeta>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  //  Pantalla de captura
  // ════════════════════════════════════════════════════════════

  const ocupado = fase !== "reposo";

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

      {/* Sin foto legible tampoco hay que quedarse trabado. */}
      <button
        onClick={cargarAMano} disabled={ocupado}
        className="btn-ghost"
        style={{
          width: "100%", justifyContent: "center", marginTop: 10,
          padding: "12px", opacity: ocupado ? 0.45 : 1,
        }}
      >
        <IconoComprobante size={16} />
        Ingresar los datos a mano
      </button>

      {/* Progreso con las etapas reales de la lectura. */}
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
            {(["preparando", "ocr", "ia"] as const).map((p, i, arr) => {
              const indice = arr.indexOf(fase as typeof arr[number]);
              const hecho = indice > i;
              const activo = indice === i;
              return (
                <span key={p} style={{
                  flex: 1, height: 3, borderRadius: 999, overflow: "hidden",
                  background: "var(--accent-borde)",
                  position: "relative",
                }}>
                  <span style={{
                    display: "block", height: "100%", borderRadius: 999,
                    background: "var(--accent)",
                    // El OCR sí sabe cuánto lleva avanzado: se muestra.
                    width: hecho ? "100%" : activo ? (p === "ocr" ? `${fraccion * 100}%` : "45%") : "0%",
                    transition: "width var(--medio) var(--curva)",
                  }} />
                </span>
              );
            })}
          </div>

          {fase === "ocr" && (
            <p style={{ fontSize: 11, color: "var(--accent-texto)", marginTop: 8, opacity: 0.8 }}>
              La primera vez se descarga el modelo de lectura; después queda en el teléfono.
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="animate-fadein" style={{ marginTop: 13 }}>
          <Aviso tono="error" icono={<IconoAlerta size={17} />}>{error}</Aviso>
        </div>
      )}

      {!getApiKey() && !ocupado && (
        <div style={{ marginTop: 13 }}>
          <Aviso tono="info" icono={<IconoLlave size={17} />}>
            Sin clave de IA la app igual funciona: lee el comprobante en el
            propio teléfono y tú completas lo que falte.
          </Aviso>
        </div>
      )}

      <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { procesar(e.target.files); e.target.value = ""; }} />
      <input ref={galeria} type="file" accept="image/*,application/pdf" className="hidden"
        onChange={e => { procesar(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════

/** Nombre con el que la foto queda archivada, para poder hallarla después. */
function nombreArchivo(v: ResultadoExtraccion, mimeType: string): string {
  const ext = mimeType === "application/pdf" ? "pdf" : "jpg";
  const doc = [v.serie, v.numero].filter(Boolean).join("-");
  const base = doc || `sin-numero-${Date.now()}`;
  const ruc = v.proveedor_ruc ? `_${v.proveedor_ruc}` : "";
  return `${base}${ruc}.${ext}`;
}

async function buscarDuplicados(
  sb: ReturnType<typeof clienteNavegador>,
  hash: string | null,
  r: ResultadoExtraccion
): Promise<{ comprobante: boolean; imagen: boolean }> {
  let porImagen = false;
  if (hash) {
    const { data } = await sb.from("gastos").select("id").eq("hash_imagen", hash).limit(1);
    porImagen = !!data?.length;
  }

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

  return { comprobante, imagen: porImagen };
}

/**
 * Reduce la imagen y calcula su huella.
 *
 * Una foto de teléfono pesa 4-6 MB y en base64 crece un 33% más: la IA la
 * rechaza o tarda demasiado, y el OCR se arrastra. A 1800 px y calidad 82%
 * baja a ~300 KB sin perder legibilidad. Los PDF se dejan intactos.
 */
async function prepararArchivo(file: File): Promise<Preparada> {
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
  return { dataUrl, base64, mimeType, hash: await sha256(base64) };
}

async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
