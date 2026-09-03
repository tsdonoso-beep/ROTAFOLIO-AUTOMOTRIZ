"use client";
import { GastoItem } from "@/lib/types";

interface Props {
  item: GastoItem;
  onChange: (id: string, patch: Partial<GastoItem>) => void;
  onProcesar: (id: string) => void;
  onEliminar: (id: string) => void;
}

export default function GastoCard({ item, onChange, onProcesar, onEliminar }: Props) {
  const e = item.extraido;

  const field = (label: string, key: keyof GastoItem, type = "text") => (
    <div>
      <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</label>
      <input
        type={type}
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-emerald-500 outline-none"
        value={(item[key] as string) ?? ""}
        onChange={(ev) => onChange(item.id, { [key]: ev.target.value })}
      />
    </div>
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Cabecera */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">{item.mimeType === "application/pdf" ? "📄" : "🖼"}</span>
          <span className="truncate text-sm font-medium text-slate-700">{item.nombre}</span>
          <span className="shrink-0 text-xs text-slate-400">{item.tamanoKB} KB</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {item.procesando && (
            <span className="text-xs text-emerald-600 animate-pulse">Procesando…</span>
          )}
          {item.error && (
            <span className="text-xs text-red-500" title={item.error}>⚠ Error</span>
          )}
          {item.procesado && !item.error && (
            <span className="text-xs text-emerald-600">✓ Extraído</span>
          )}
          {item.drive_url && (
            <a href={item.drive_url} target="_blank" rel="noreferrer"
              className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs text-blue-600 hover:bg-blue-100">
              📁 Drive
            </a>
          )}
          {!item.procesado && !item.procesando && (
            <button onClick={() => onProcesar(item.id)}
              className="rounded-lg bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-700">
              Extraer con IA
            </button>
          )}
          <button onClick={() => onEliminar(item.id)}
            className="text-slate-400 hover:text-red-500 text-lg leading-none">×</button>
        </div>
      </div>

      {/* Datos extraídos */}
      {e && (
        <div className="border-b border-slate-100 bg-emerald-50/50 px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <Row label="Proveedor" value={e.proveedor} />
          <Row label="Tipo" value={e.tipo_comprobante} />
          <Row label="N° Comprobante" value={e.numero_comprobante} />
          <Row label="Fecha" value={e.fecha_comprobante} />
          <Row label="Forma de pago" value={e.forma_pago} />
          <Row label="Total" value={`${e.moneda === "USD" ? "$" : "S/"} ${e.monto_total?.toFixed(2)}`} bold />
          <div className="col-span-2"><Row label="Detalle" value={e.detalle} /></div>
        </div>
      )}

      {/* Campos manuales */}
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        {field("N° Solicitud", "numero_solicitud")}
        {field("Fecha Solicitud", "fecha_solicitud", "date")}
        {field("Empresa", "empresa")}
        {field("Responsable", "responsable")}
        {field("Área / Proyecto", "area_proyecto")}
        {field("Solicitante", "solicitante")}
        <div className="sm:col-span-2">
          <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Descripción / Motivo del Gasto
          </label>
          <textarea
            rows={2}
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-emerald-500 outline-none resize-none"
            value={item.motivo}
            onChange={(e) => onChange(item.id, { motivo: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-500">Estado</label>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-emerald-500 outline-none"
            value={item.estado}
            onChange={(e) => onChange(item.id, { estado: e.target.value as GastoItem["estado"] })}
          >
            <option value="PENDIENTE">PENDIENTE</option>
            <option value="PAGADO">PAGADO</option>
            <option value="ANULADO">ANULADO</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex gap-1">
      <span className="shrink-0 text-slate-500">{label}:</span>
      <span className={`truncate text-slate-700 ${bold ? "font-semibold" : ""}`}>{value || "—"}</span>
    </div>
  );
}
