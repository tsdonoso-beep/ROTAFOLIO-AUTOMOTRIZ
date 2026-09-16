"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Captura, { type MemoDisponible } from "./Captura";
import GastoFila from "./GastoFila";
import PanelDevolucion from "./PanelDevolucion";
import RetornoDePasajes from "./RetornoDePasajes";
import PanelConstancias from "./PanelConstancias";
import type { Beneficiario, Constancia } from "@/lib/dominio/pago";
import { Aviso, Cifra, EstadoMemo, Medidor, Tarjeta, Vacio, soles } from "./Encabezado";
import {
  IconoAlerta, IconoAtras, IconoComentario, IconoComprobante, IconoCheck,
} from "./Iconos";
import { clienteNavegador } from "@/lib/supabase/cliente";
import { consolidar } from "@/lib/dominio/memo";
import { impedimentosParaPresentar, MEMO_EDITABLE, puedeEditarGasto } from "@/lib/dominio/estados";
import { editarGasto, presentarRendicion, type DatosGasto } from "@/app/acciones/memos";
import type { EstadoGasto, EstadoMemo as TEstadoMemo, Gasto, Parametros } from "@/lib/dominio/tipos";

interface Props {
  memo: {
    id: string; correlativo: string; estado: TEstadoMemo; destino: string | null;
    tipo?: string;
    /** El viático del que cuelga este memo, si es de pasajes. */
    padre?: { id: string; correlativo: string } | null;
    monto_autorizado: number; fecha_salida: string | null; fecha_retorno_prev: string | null;
    observacion_actual: string | null;
    centro: { codigo: string; nombre: string } | null;
    /** Cuánta gente cubre el memo. Si es más de una, el memo no es de nadie solo. */
    cuadrilla?: number;
  };
  gastos: Gasto[];
  parametros: Parametros;
  puedeCapturar: boolean;
  puedeAdministrar?: boolean;
  usuarioId?: string;
  /** A quién cubre el memo, para cruzarlo contra lo que pagó el banco. */
  beneficiarios?: Beneficiario[];
  constancias?: Constancia[];
  /** Lo que le tocó a quien mira: su monto y su tramo. */
  asignado?: { monto: number; fecha_desde: string | null; fecha_hasta: string | null } | null;
  devoluciones?: Array<{
    id: string; monto: number; operacion: string | null;
    fecha: string; nota: string | null;
  }>;
  /** Este memo, en la forma que la captura necesita para validar y archivar. */
  memoCaptura: MemoDisponible;
}

export default function VistaMemo({
  memo, gastos, parametros, puedeCapturar, memoCaptura,
  puedeAdministrar = false, usuarioId, asignado = null, devoluciones = [],
  beneficiarios = [], constancias = [],
}: Props) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [aviso, setAviso] = useState<{ tipo: "error" | "ok"; texto: string } | null>(null);

  // Contra lo que le tocó a esta persona, no contra el memo entero. En el
  // 594-2026 son S/ 212.00 de S/ 9,064.00: con el número del memo, la
  // pantalla le diría que le sobran ocho mil ochocientos soles.
  const autorizado = asignado ? asignado.monto : Number(memo.monto_autorizado);
  const c = useMemo(() => consolidar(autorizado, gastos), [autorizado, gastos]);

  const devuelto = useMemo(
    () => Math.round(devoluciones.reduce((s, d) => s + d.monto, 0) * 100) / 100,
    [devoluciones]
  );
  // Lo que todavía falta que vuelva a la empresa.
  const porDevolver = Math.round((c.devolucion - devuelto) * 100) / 100;
  const editable = MEMO_EDITABLE.includes(memo.estado);
  const impedimentos = useMemo(() => impedimentosParaPresentar(gastos), [gastos]);
  const excedido = c.rendido > c.autorizado;

  const confirmarAlertas = (id: string) => {
    iniciar(async () => {
      await clienteNavegador().from("gastos")
        .update({ alertas_confirmadas: true, estado: "VALIDADO" }).eq("id", id);
      router.refresh();
    });
  };

  const eliminar = (id: string) => {
    iniciar(async () => {
      const { error } = await clienteNavegador().from("gastos").delete().eq("id", id);
      if (error) setAviso({ tipo: "error", texto: error.message });
      router.refresh();
    });
  };

  const guardarEdicion = async (id: string, datos: DatosGasto) => {
    const r = await editarGasto(id, datos);
    if (r.ok) router.refresh();
    return r;
  };

  const presentar = () => {
    if (!confirm(`Se presentarán ${c.cantidad_gastos} comprobantes por ${soles(c.rendido)}. Después no podrás editarlos. ¿Continuar?`)) return;
    iniciar(async () => {
      const r = await presentarRendicion(memo.id);
      if (r.ok) {
        setAviso({ tipo: "ok", texto: "Rendición presentada. Pasó a revisión." });
        router.refresh();
      } else {
        setAviso({ tipo: "error", texto: r.error });
      }
    });
  };

  return (
    <>
      <Link href="/memos" className="hover-atras" style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 13, color: "var(--text2)", textDecoration: "none", marginBottom: 16,
      }}>
        <IconoAtras size={15} />
        Mis memos
      </Link>

      {/* ══ Cabecera: las cifras son el contenido ══ */}
      <Tarjeta padding={0} style={{ overflow: "hidden", marginBottom: 16 }}>
        <div style={{ padding: "20px 22px 18px" }}>
          <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
            <span className="mono" style={{
              fontSize: 12, color: "var(--text2)", background: "var(--surface2)",
              padding: "4px 9px", borderRadius: 7, border: "1px solid var(--border)",
            }}>
              {memo.correlativo}
            </span>
            <EstadoMemo estado={memo.estado} />
          </div>

          <h1 className="font-display" style={{
            fontSize: 22, fontWeight: 800, color: "var(--text)",
            letterSpacing: "-0.03em", marginTop: 11, lineHeight: 1.2,
          }}>
            {memo.destino || memo.centro?.nombre}
          </h1>

          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 7 }}>
            {memo.centro && (
              <span style={{ fontSize: 12.5, color: "var(--text2)" }}>
                <span className="mono">{memo.centro.codigo}</span> · {memo.centro.nombre}
              </span>
            )}
          </div>
          {memo.fecha_salida && (
            <p style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 3 }}>
              {memo.fecha_salida} al {memo.fecha_retorno_prev}
            </p>
          )}
        </div>

        {/* Zona hundida para las cifras: se lee como un panel de instrumentos */}
        <div style={{
          background: "var(--surface2)", borderTop: "1px solid var(--border)",
          padding: "18px 22px 20px",
        }}>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 16,
          }}>
            <Cifra
              rotulo="Autorizado"
              valor={c.sinAdelanto ? "sin adelanto" : soles(c.autorizado)}
              tamano="l" tono="tenue"
            />
            <Cifra rotulo="Rendido" valor={soles(c.rendido)} tamano="xl"
              tono={excedido && !c.sinAdelanto ? "peligro" : "neutro"} />
            <Cifra
              rotulo={c.sinAdelanto ? "A reembolsar" : excedido ? "Excedido" : "Saldo"}
              valor={soles(c.sinAdelanto || excedido ? c.reembolso : c.saldo)}
              tamano="l"
              tono={excedido && !c.sinAdelanto ? "peligro" : "acento"}
            />
          </div>

          {/* Sin adelanto no hay barra que llenar: el medidor mide consumo
              de un monto autorizado, y acá no hay ninguno. */}
          {!c.sinAdelanto && <Medidor rendido={c.rendido} autorizado={c.autorizado} />}

          {/* Un memo de cuadrilla autoriza un total que no es de nadie: lo
              que cada quien debe rendir es su fila del anexo. */}
          {asignado && (memo.cuadrilla ?? 1) > 1 && (
            <p style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.45, marginTop: 10 }}>
              Este memo cubre a {memo.cuadrilla} personas por {soles(Number(memo.monto_autorizado))}.
              Lo de arriba es lo tuyo: {soles(asignado.monto)}
              {asignado.fecha_desde && ` · del ${asignado.fecha_desde} al ${asignado.fecha_hasta}`}.
            </p>
          )}

          {c.cantidad_gastos > 0 && (
            <div style={{
              display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap",
              fontSize: 12, color: "var(--text2)",
            }}>
              <span>{c.cantidad_gastos} comprobante{c.cantidad_gastos === 1 ? "" : "s"}</span>
              {/* El formato de rendición lo pide aparte: «monto rendido (solo
                  FT)». Una boleta es gasto deducible, pero no descuenta IGV. */}
              <span title="Solo los comprobantes con IGV discriminado">
                Crédito fiscal <strong style={{ color: "var(--text)" }}>{soles(c.credito_fiscal)}</strong>
              </span>
              {c.con_alertas > 0 && (
                <span style={{ color: "var(--warn)", fontWeight: 600 }}>
                  {c.con_alertas} con alerta
                </span>
              )}
              {c.bloqueantes > 0 && (
                <span style={{ color: "var(--danger)", fontWeight: 700 }}>
                  {c.bloqueantes} bloqueante{c.bloqueantes === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}
        </div>
      </Tarjeta>

      {/* ══ El retorno de un memo de pasajes ══ */}
      {memo.tipo === "PASAJES" && (
        <RetornoDePasajes
          memoId={memo.id}
          estado={memo.estado}
          fechaSalida={memo.fecha_salida}
          fechaRetorno={memo.fecha_retorno_prev}
          padre={memo.padre ?? null}
          puedeEditar={puedeAdministrar}
        />
      )}

      {/* ══ Lo que de verdad cobró cada quien ══ */}
      <PanelConstancias
        memoId={memo.id}
        autorizado={Number(memo.monto_autorizado)}
        beneficiarios={beneficiarios}
        constancias={constancias}
        puedeRegistrar={puedeAdministrar}
      />

      {/* ══ La devolución del saldo ══ */}
      {usuarioId && (
        <PanelDevolucion
          memoId={memo.id}
          usuarioId={usuarioId}
          porDevolver={porDevolver}
          devoluciones={devoluciones}
        />
      )}

      {/* ══ Observación del revisor ══ */}
      {memo.estado === "OBSERVADA" && memo.observacion_actual && (
        <div style={{ marginBottom: 16 }}>
          <Aviso tono="error" icono={<IconoComentario size={17} />}>
            <strong style={{ fontFamily: "var(--font-sora), sans-serif" }}>
              Rendición observada.
            </strong>{" "}
            {memo.observacion_actual} Corrige solo los marcados y vuelve a presentar;
            el resto sigue congelado.
          </Aviso>
        </div>
      )}

      {/* ══ Captura ══ */}
      {editable && puedeCapturar && (
        <Tarjeta style={{ marginBottom: 16 }}>
          <p className="rotulo" style={{ marginBottom: 13 }}>Agregar comprobante</p>
          <Captura
            memos={[{ ...memoCaptura, rendido: c.rendido }]}
            memoInicial={memo.id}
            parametros={parametros}
            onListo={() => setAviso({ tipo: "ok", texto: "Comprobante agregado." })}
          />
        </Tarjeta>
      )}

      {aviso && (
        <div style={{ marginBottom: 16 }}>
          <Aviso
            tono={aviso.tipo === "ok" ? "ok" : "error"}
            icono={aviso.tipo === "ok" ? <IconoCheck size={16} /> : <IconoAlerta size={16} />}
          >
            {aviso.texto}
          </Aviso>
        </div>
      )}

      {/* ══ Comprobantes ══ */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginBottom: 11,
      }}>
        <p className="rotulo">Comprobantes ({gastos.length})</p>
      </div>

      {!gastos.length ? (
        <Vacio
          icono={<IconoComprobante size={26} />}
          titulo="Todavía no hay comprobantes"
          texto={puedeCapturar
            ? "Toma una foto del primer comprobante. La IA lee el proveedor, el número y los montos por ti."
            : "Cuando quien rinde cargue comprobantes, aparecerán aquí."}
        />
      ) : (
        <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {gastos.map(g => (
            <GastoFila
              key={g.id} gasto={g}
              umbralConfianza={parametros.umbral_confianza_alerta}
              editable={puedeCapturar && puedeEditarGasto(g.estado as EstadoGasto, memo.estado)}
              parametros={parametros}
              onConfirmar={confirmarAlertas}
              onEliminar={eliminar}
              onEditar={guardarEdicion}
            />
          ))}
        </div>
      )}

      {/* ══ Presentar ══ */}
      {editable && gastos.length > 0 && (
        <div style={{ marginTop: 20 }}>
          {impedimentos.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Aviso tono="aviso" icono={<IconoAlerta size={17} />}>
                <strong style={{
                  fontFamily: "var(--font-sora), sans-serif", display: "block", marginBottom: 4,
                }}>
                  Falta resolver antes de presentar
                </strong>
                {impedimentos.map((i, k) => (
                  <span key={k} style={{ display: "block", lineHeight: 1.65 }}>
                    · {i.motivo}{i.cantidad > 0 && ` (${i.cantidad})`}
                  </span>
                ))}
              </Aviso>
            </div>
          )}

          <button
            className="btn-primary" onClick={presentar}
            disabled={pendiente || impedimentos.length > 0}
            style={{ width: "100%", justifyContent: "center", padding: 15, fontSize: 14.5 }}
          >
            {pendiente ? "Presentando…" : (
              <>
                <IconoCheck size={18} />
                Presentar rendición · {soles(c.rendido)}
              </>
            )}
          </button>
        </div>
      )}
    </>
  );
}
