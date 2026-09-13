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
