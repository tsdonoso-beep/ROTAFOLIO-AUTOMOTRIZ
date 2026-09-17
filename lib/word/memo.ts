// El memo deja de escribirse y pasa a generarse
//
// Hoy alguien abre el Word del memo anterior, cambia el número, cambia los
// nombres, cambia los montos y suma el total a mano. De ahí salen los dos
// defectos que encontramos en los documentos reales: un memo que se
// contradice a sí mismo —el párrafo dice un total y el anexo dice otro— y
// nombres de archivo que el MemoTracker no sabe leer.
//
// Acá el documento sale de la base. El total no se escribe: es la suma del
// anexo, la misma que ya calcula `revisarAnexo`.
//
// El nombre del archivo importa tanto como el contenido. Franco lo dijo en
// la reunión y los datos lo confirmaron: en 341 de 422 memos el asunto del
// correo no trae el número, así que su herramienta lee el NOMBRE DEL
// ADJUNTO. Si el nombre no calza, el memo entra a su hoja sin número y
// alguien lo corrige a mano.

import { armarZip, escaparXml } from "./zip.ts";

export interface PersonaDelAnexo {
  nombre: string;
  dni: string;
  cargo?: string | null;
  monto: number;
  fechaDesde: string | null;
  fechaHasta: string | null;
}

export interface DatosDelMemo {
  /** El número tal como se nombra: «594-2026». */
  numero: string;
  /** A qué se destina. Va en el nombre del archivo. */
  concepto: string;
  /** El área o proyecto. También va en el nombre. */
  area: string;
  empresa: string;
  destino: string | null;
  /** Quién firma. En el 594-2026, José Haertel. */
  firmante: string;
  cargoFirmante: string | null;
  /** A quién va dirigido. Siempre la Gerencia de Administración y Finanzas. */
  dirigidoA: string;
  fecha: string;
  personas: PersonaDelAnexo[];
}

/** dd/mm/aaaa, que es como se leen las fechas en el papel. */
export function aFechaPeruana(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const soles = (n: number) =>
  n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Limpia lo que no puede ir en un nombre de archivo.
 *
 * Windows rechaza `\ / : * ? " < > |`, y Drive se atraganta con las barras.
 * Se reemplazan por un espacio en vez de borrarse: «VIATICOS/PASAJES» tiene
 * que quedar «VIATICOS PASAJES» y no «VIATICOSPASAJES».
 */
export function limpiarParaArchivo(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * El nombre exacto del adjunto: `Memo NNN-AAAA - CONCEPTO - ÁREA`.
 *
 * Es lo que lee el MemoTracker. No lleva extensión acá: la pone quien
 * escribe el archivo.
 */
export function nombreDeArchivo(d: {
  numero: string; concepto: string; area: string
}): string {
  const partes = [
    `Memo ${limpiarParaArchivo(d.numero)}`,
    limpiarParaArchivo(d.concepto).toUpperCase(),
    limpiarParaArchivo(d.area),
  ].filter(p => p && p !== "Memo ");

  return partes.join(" - ");
}

/** El total del memo. Se suma; nunca se escribe. */
export function totalDelAnexo(personas: PersonaDelAnexo[]): number {
  return personas.reduce((s, p) => s + Math.round(p.monto * 100), 0) / 100;
}

// ════════════════════════════════════════════════════════════════
// El documento
// ════════════════════════════════════════════════════════════════

const p = (texto: string, opciones: { negrita?: boolean; centrado?: boolean } = {}) =>
  `<w:p><w:pPr>${opciones.centrado ? '<w:jc w:val="center"/>' : ""}</w:pPr>`
  + `<w:r><w:rPr>${opciones.negrita ? "<w:b/>" : ""}</w:rPr>`
  + `<w:t xml:space="preserve">${escaparXml(texto)}</w:t></w:r></w:p>`;

const celda = (texto: string, negrita = false) =>
  `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${p(texto, { negrita })}</w:tc>`;

function tablaDelAnexo(personas: PersonaDelAnexo[]): string {
  const cabecera = `<w:tr>${
    ["N°", "APELLIDOS Y NOMBRES", "DNI", "DESDE", "HASTA", "MONTO S/"]
      .map(c => celda(c, true)).join("")
  }</w:tr>`;

  const filas = personas.map((x, i) => `<w:tr>${[
    celda(String(i + 1)),
    celda(x.nombre),
    celda(x.dni),
    celda(aFechaPeruana(x.fechaDesde)),
    celda(aFechaPeruana(x.fechaHasta)),
    celda(soles(x.monto)),
  ].join("")}</w:tr>`).join("");

  const total = `<w:tr>${[
    celda(""), celda("TOTAL", true), celda(""), celda(""), celda(""),
    celda(soles(totalDelAnexo(personas)), true),
  ].join("")}</w:tr>`;

  return `<w:tbl><w:tblPr><w:tblBorders>${
    ["top", "left", "bottom", "right", "insideH", "insideV"]
      .map(b => `<w:${b} w:val="single" w:sz="4" w:color="auto"/>`).join("")
  }</w:tblBorders></w:tblPr>${cabecera}${filas}${total}</w:tbl>`;
}

function cuerpo(d: DatosDelMemo): string {
  const total = totalDelAnexo(d.personas);
  const cuantos = d.personas.length;

  // El párrafo que hoy se escribe a mano, y donde aparecen las
  // contradicciones: el monto sale de la suma, no de lo que alguien recuerde.
  const parrafo =
    `Por medio del presente, solicito la asignación de viáticos por la suma de `
    + `S/ ${soles(total)} para ${cuantos} ${cuantos === 1 ? "colaborador" : "colaboradores"}`
    + `${d.destino ? `, con destino a ${d.destino}` : ""}, según el detalle del anexo `
    + `que se adjunta.`;

  return [
    p(d.empresa, { negrita: true, centrado: true }),
    p(`MEMORÁNDUM N° ${d.numero}`, { negrita: true, centrado: true }),
    p(""),
    p(`A     : ${d.dirigidoA}`),
    p(`DE    : ${d.firmante}${d.cargoFirmante ? ` — ${d.cargoFirmante}` : ""}`),
    p(`ASUNTO: ${d.concepto}`),
    p(`FECHA : ${d.fecha}`),
    p(""),
    p(parrafo),
    p(""),
    p("ANEXO", { negrita: true }),
    tablaDelAnexo(d.personas),
    p(""),
    p("Atentamente,"),
    p(""),
    p(""),
    p(d.firmante, { centrado: true }),
    d.cargoFirmante ? p(d.cargoFirmante, { centrado: true }) : "",
  ].join("");
}

const TIPOS_DE_CONTENIDO = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELACIONES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/** El .docx, listo para adjuntar. */
export function generarMemo(d: DatosDelMemo): Uint8Array {
  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${cuerpo(d)}<w:sectPr/></w:body></w:document>`;

  return armarZip([
    { nombre: "[Content_Types].xml", contenido: TIPOS_DE_CONTENIDO },
    { nombre: "_rels/.rels", contenido: RELACIONES },
    { nombre: "word/document.xml", contenido: documento },
  ]);
}
