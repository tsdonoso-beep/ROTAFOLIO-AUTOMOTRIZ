// Leer la bitácora de consultas a SUNAT
//
// La política de lectura la limita a quien ya puede ver todos los gastos, así
// que esto no filtra por su cuenta: si alguien sin permiso llegara acá, la
// base devuelve una lista vacía, no un error.

import { clienteServidor } from "@/lib/supabase/servidor";

export interface ConsultaSunat {
  id: string;
  periodo: string;
  empresaRuc: string;
  consultadoEn: string;
  quien: string | null;
  comprobantesSunat: number;
  comprobantesNuestros: number;
  cuadran: number;
  montoDistinto: number;
  noEstanEnSunat: number;
  noComparables: number;
  soloEnSunat: number;
  montoSoloEnSunat: number;
  columnasFaltantes: string[];
  identidadSospechosa: string | null;
  segundos: number | null;
}

export async function ultimasConsultas(cuantas = 25): Promise<ConsultaSunat[]> {
  const sb = await clienteServidor();
  const { data } = await sb
    .from("consultas_sunat")
    .select(`
      id, periodo, empresa_ruc, consultado_en, comprobantes_sunat,
      comprobantes_nuestros, cuadran, monto_distinto, no_estan_en_sunat,
      no_comparables, solo_en_sunat, monto_solo_en_sunat, columnas_faltantes,
      identidad_sospechosa, segundos,
      usuarios:consultado_por ( nombre )
    `)
    .order("consultado_en", { ascending: false })
    .limit(cuantas);

  return (data ?? []).map(c => {
    const u = c.usuarios as unknown as { nombre?: string } | null;
    return {
      id: c.id,
      periodo: c.periodo,
      empresaRuc: c.empresa_ruc,
      consultadoEn: c.consultado_en,
      quien: u?.nombre ?? null,
      comprobantesSunat: c.comprobantes_sunat,
      comprobantesNuestros: c.comprobantes_nuestros,
      cuadran: c.cuadran,
      montoDistinto: c.monto_distinto,
      noEstanEnSunat: c.no_estan_en_sunat,
      noComparables: c.no_comparables,
      soloEnSunat: c.solo_en_sunat,
      montoSoloEnSunat: Number(c.monto_solo_en_sunat ?? 0),
      columnasFaltantes: c.columnas_faltantes ?? [],
      identidadSospechosa: c.identidad_sospechosa,
      segundos: c.segundos,
    };
  });
}

/** Un comprobante que llegó distinto de como estaba. */
export interface CambioDetectado {
  id: string;
  notadoEn: string;
  campo: string;
  antes: string | null;
  despues: string | null;
  periodo: string;
  proveedorNombre: string | null;
  proveedorRuc: string | null;
  comprobante: string;
  tipoComprobante: string | null;
}

/**
 * Los comprobantes que cambiaron desde que los vimos por primera vez.
 *
 * Es la respuesta a «esta factura ahora está anulada». Sin mostrarlo, la
 * detección queda guardada y no la mira nadie, que es lo mismo que no
 * detectarla.
 */
export async function ultimosCambios(cuantos = 30): Promise<CambioDetectado[]> {
  const sb = await clienteServidor();
  const { data } = await sb
    .from("cambios_comprobante_sunat")
    .select(`
      id, notado_en, campo, antes, despues,
      comprobantes_sunat!inner (
        periodo, proveedor_nombre, proveedor_ruc, serie, numero, tipo_comprobante
      )
    `)
    .order("notado_en", { ascending: false })
    .limit(cuantos);

  return (data ?? []).map(c => {
    const s = c.comprobantes_sunat as unknown as {
      periodo: string; proveedor_nombre: string | null; proveedor_ruc: string | null;
      serie: string | null; numero: string | null; tipo_comprobante: string | null;
    };
    return {
      id: c.id,
      notadoEn: c.notado_en,
      campo: c.campo,
      antes: c.antes,
      despues: c.despues,
      periodo: s.periodo,
      proveedorNombre: s.proveedor_nombre,
      proveedorRuc: s.proveedor_ruc,
      comprobante: [s.serie, s.numero].filter(Boolean).join("-"),
      tipoComprobante: s.tipo_comprobante,
    };
  });
}
