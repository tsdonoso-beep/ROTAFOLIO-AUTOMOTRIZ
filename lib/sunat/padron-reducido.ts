/**
 * El padrón reducido del RUC de SUNAT: el domicilio fiscal de cada RUC.
 *
 * SUNAT publica cada día un archivo con todos los RUC del país
 * (http://www2.sunat.gob.pe/padron_reducido_ruc.zip, ~400 MB comprimido,
 * ~1.5 GB de texto en latin1). Una línea por RUC, separada por «|»:
 *
 *   RUC|NOMBRE O RAZÓN SOCIAL|ESTADO DEL CONTRIBUYENTE|CONDICIÓN DE DOMICILIO|UBIGEO|
 *   TIPO DE VÍA|NOMBRE DE VÍA|CÓDIGO DE ZONA|TIPO DE ZONA|NÚMERO|INTERIOR|LOTE|
 *   DEPARTAMENTO|MANZANA|KILÓMETRO|
 *
 * «-» es vacío. «DEPARTAMENTO» es el del edificio (dpto. 902), no la región:
 * la región sale del UBIGEO (INEI), que acá se traduce a nombres.
 *
 * Las personas naturales (RUC 10…) vienen sin dirección: SUNAT no la publica.
 *
 * Pedido de Contabilidad (reunión del 06/10/2026): ver en la búsqueda del
 * proveedor dónde está —sin entrar a la Consulta RUC— y, más adelante, armar
 * con eso la ubicación de cada OC.
 */

export type DomicilioRuc = {
  ruc: string;
  razonSocial: string;
  /** «ACTIVO», «BAJA DE OFICIO», «SUSPENSION TEMPORAL»… */
  estado: string;
  /** «HABIDO», «NO HABIDO», «NO HALLADO…» */
  condicion: string;
  /** Seis dígitos del INEI («150131»), o "" si no tiene. */
  ubigeo: string;
  /** La dirección armada como la muestra SUNAT: «JR. CUZCO NRO. 343 URB. …». */
  direccion: string;
};

/** Un nombre de ubigeo por código: «15» → Lima, «1501» → Lima, «150131» → San Isidro. */
export type Ubigeos = Map<string, string>;

const vacio = (v: string | undefined) => {
  const t = String(v ?? "").trim();
  return t === "-" || /^-+$/.test(t) ? "" : t;
};

/** «JR. CUZCO NRO. 343 INT. 5 URB. SANTA CATALINA», en el orden de la Consulta RUC. */
export function armarDireccion(c: string[]): string {
  const [tipoVia, nombreVia, codZona, tipoZona, numero, interior, lote, dpto, manzana, km] = c.map(vacio);
  return [
    nombreVia ? [tipoVia, nombreVia].filter(Boolean).join(" ") : "",
    numero && `NRO. ${numero}`,
    interior && `INT. ${interior}`,
    dpto && `DPTO. ${dpto}`,
    manzana && `MZA. ${manzana}`,
    lote && `LOTE. ${lote}`,
    km && `KM. ${km}`,
    tipoZona ? [codZona, tipoZona].filter(Boolean).join(" ") : "",
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/** Una línea del padrón (ya pasada de latin1 a texto); null si no es una fila de datos. */
export function leerLineaPadron(linea: string): DomicilioRuc | null {
  const c = linea.split("|");
  if (c.length < 15 || !/^\d{11}$/.test(c[0])) return null;
  const ubigeo = vacio(c[4]);
  return {
    ruc: c[0],
    razonSocial: vacio(c[1]),
    estado: vacio(c[2]),
    condicion: vacio(c[3]),
    ubigeo: /^\d{6}$/.test(ubigeo) ? ubigeo : "",
    direccion: armarDireccion(c.slice(5, 15)),
  };
}

/**
 * Los nombres del ubigeo desde la lista del INEI
 * ([{ departamento: "15", provincia: "01", distrito: "31", nombre: "San Isidro" }, …],
 * con «00» para el nivel que no aplica).
 */
export function ubigeosDesdeLista(lista: Array<{ departamento: string; provincia: string; distrito: string; nombre: string }>): Ubigeos {
  const m: Ubigeos = new Map();
  for (const u of lista) {
    const d = String(u.departamento).padStart(2, "0"), p = String(u.provincia).padStart(2, "0"), t = String(u.distrito).padStart(2, "0");
    const codigo = p === "00" ? d : t === "00" ? d + p : d + p + t;
    m.set(codigo, String(u.nombre).trim());
  }
  return m;
}

/** Departamento, provincia y distrito de un ubigeo («150131» → Lima, Lima, San Isidro). */
export function lugarDeUbigeo(ubigeo: string, nombres: Ubigeos): { departamento: string; provincia: string; distrito: string } {
  if (!/^\d{6}$/.test(ubigeo)) return { departamento: "", provincia: "", distrito: "" };
  return {
    departamento: nombres.get(ubigeo.slice(0, 2)) ?? "",
    provincia: nombres.get(ubigeo.slice(0, 4)) ?? "",
    distrito: nombres.get(ubigeo) ?? "",
  };
}
