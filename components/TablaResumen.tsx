"use client";
import { GastoItem } from "@/lib/types";

interface Props {
  items: GastoItem[];
}

const moneda = (n: number) =>
  `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function TablaResumen({ items }: Props) {
  const procesados = items.filter((i) => i.procesado && !i.error);
  const total = procesados.reduce((s, i) => s + (i.extraido?.monto_total ?? 0), 0);

  if (!procesados.length) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold text-slate-800">Resumen de Gastos</h2>
        <span className="text-sm font-semibold text-emerald-700">{moneda(total)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">N° Sol.</th>
              <th className="px-3 py-2">Proveedor</th>
              <th className="px-3 py-2">Detalle</th>
              <th className="px-3 py-2">Comprobante</th>
              <th className="px-3 py-2">Fecha Comp.</th>
              <th className="px-3 py-2 text-right">Total S/</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Imagen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {procesados.map((item) => {
              const e = item.extraido!;
              return (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-slate-600">{item.numero_solicitud || "—"}</td>
                  <td className="px-3 py-2 font-medium text-slate-700 max-w-[120px] truncate">{e.proveedor || "—"}</td>
                  <td className="px-3 py-2 text-slate-500 max-w-[160px] truncate">{e.detalle || item.motivo || "—"}</td>
                  <td className="px-3 py-2 text-slate-600">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">{e.tipo_comprobante}</span>
                    {e.numero_comprobante && <span className="ml-1 text-slate-400">{e.numero_comprobante}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{e.fecha_comprobante || "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-800">
                    {e.monto_total ? moneda(e.monto_total) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      item.estado === "PAGADO"
                        ? "bg-emerald-100 text-emerald-700"
                        : item.estado === "ANULADO"
                        ? "bg-red-100 text-red-600"
                        : "bg-amber-100 text-amber-700"
                    }`}>
                      {item.estado}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {item.drive_url ? (
                      <a href={item.drive_url} target="_blank" rel="noreferrer"
                        className="text-blue-600 hover:underline">
                        🔗 Ver
                      </a>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-semibold">
              <td colSpan={5} className="px-3 py-2 text-right text-slate-600">TOTAL</td>
              <td className="px-3 py-2 text-right text-emerald-700">{moneda(total)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
