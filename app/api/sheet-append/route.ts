import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

/** Orden de las columnas en la planilla. No cambiar sin migrar la hoja. */
const CABECERAS = [
  "ID Gasto",
  "Fecha Registro",
  "Registrado Por",
  "Proyecto",
  "Centro de Costos",
  "Caja / Memo",
  "N° Solicitud",
  "Fecha Solicitud",
  "Proveedor",
  "Tipo Comprobante",
  "N° Comprobante",
  "Fecha Comprobante",
  "Moneda",
  "Subtotal",
  "IGV",
  "Total",
  "Forma de Pago",
  "Detalle",
  "Empresa",
  "Responsable",
  "Área / Proyecto",
  "Solicitante",
  "Motivo",
  "Estado",
  "Enlace Drive",
];

const HOJA = "Registro";

export interface FilaRegistro {
  id_gasto: string;
  usuario_nombre: string;
  proyecto_nombre: string;
  centro_costos: string;
  caja: string;
  numero_solicitud: string;
  fecha_solicitud: string;
  proveedor: string;
  tipo_comprobante: string;
  numero_comprobante: string;
  fecha_comprobante: string;
  moneda: string;
  subtotal: number;
  igv: number;
  total: number;
  forma_pago: string;
  detalle: string;
  empresa: string;
  responsable: string;
  area_proyecto: string;
  solicitante: string;
  motivo: string;
  estado: string;
  drive_url: string;
}

export async function POST(req: NextRequest) {
  try {
    const fila = (await req.json()) as FilaRegistro;

    const email = process.env.GOOGLE_SA_EMAIL;
    const key = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const sheetId = process.env.GOOGLE_SHEET_ID;

    if (!email || !key) {
      return NextResponse.json(
        { error: "Credenciales de Google no configuradas en el servidor." },
        { status: 500 }
      );
    }
    if (!sheetId) {
      return NextResponse.json(
        { error: "Falta GOOGLE_SHEET_ID. Agrégala en las variables de entorno." },
        { status: 500 }
      );
    }

    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: email, private_key: key },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    await asegurarHoja(sheets, sheetId);

    // El sello de fecha lo pone el servidor, no el navegador: así no se puede
    // falsear cambiando el reloj del equipo.
    const fechaRegistro = new Date().toISOString();

    const valores = [
      fila.id_gasto,
      fechaRegistro,
      fila.usuario_nombre,
      fila.proyecto_nombre,
      fila.centro_costos,
      fila.caja,
      fila.numero_solicitud,
      fila.fecha_solicitud,
      fila.proveedor,
      fila.tipo_comprobante,
      fila.numero_comprobante,
      fila.fecha_comprobante,
      fila.moneda,
      fila.subtotal,
      fila.igv,
      fila.total,
      fila.forma_pago,
      fila.detalle,
      fila.empresa,
      fila.responsable,
      fila.area_proyecto,
      fila.solicitante,
      fila.motivo,
      fila.estado,
      fila.drive_url,
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${HOJA}!A:Y`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [valores] },
    });

    return NextResponse.json({ ok: true, fecha: fechaRegistro });
  } catch (e) {
    console.error("Sheet append error:", e);
    const msg = (e as Error).message;

    // La API de Sheets se habilita por separado de la de Drive: es el fallo
    // más común al conectar la planilla por primera vez.
    const amigable = /has not been used in project|is disabled/i.test(msg)
      ? "La API de Google Sheets no está habilitada en el proyecto de Google Cloud. Actívala en la consola de Google Cloud y espera un par de minutos."
      : /not found/i.test(msg)
      ? "No se encontró la planilla. Verifica el ID y que esté compartida con la cuenta de servicio."
      : /permission|forbidden/i.test(msg)
      ? "La cuenta de servicio no tiene permiso de edición sobre la planilla."
      : msg;
    return NextResponse.json({ error: amigable }, { status: 500 });
  }
}

/** Crea la hoja y su fila de cabeceras la primera vez. */
async function asegurarHoja(
  sheets: ReturnType<typeof google.sheets>,
  sheetId: string
): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const existe = meta.data.sheets?.some(
    (s) => s.properties?.title === HOJA
  );

  if (!existe) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: HOJA } } }],
      },
    });
  }

  const primera = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${HOJA}!A1:Y1`,
  });

  if (!primera.data.values?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${HOJA}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [CABECERAS] },
    });
  }
}
