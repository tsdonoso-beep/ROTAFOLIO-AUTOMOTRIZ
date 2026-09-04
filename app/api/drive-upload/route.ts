import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { Readable } from "stream";

/**
 * La carpeta de destino vive en una unidad compartida. La API de Drive las
 * ignora por completo salvo que se le pasen estos parámetros en CADA llamada;
 * sin ellos responde "File not found" aunque la carpeta exista y la cuenta de
 * servicio tenga permisos.
 */
const DRIVES = { supportsAllDrives: true, includeItemsFromAllDrives: true };

export async function POST(req: NextRequest) {
  try {
    const { base64, mimeType, fileName, carpeta1, carpeta2 } = (await req.json()) as {
      base64: string;
      mimeType: string;
      fileName: string;
      carpeta1: string; // centro de costos
      carpeta2: string; // caja / memo
    };

    const email = process.env.GOOGLE_SA_EMAIL;
    const key = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const rootId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!email || !key || !rootId) {
      return NextResponse.json(
        { error: "Credenciales de Drive no configuradas en el servidor." },
        { status: 500 }
      );
    }

    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: email, private_key: key },
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    const drive = google.drive({ version: "v3", auth });

    // Estructura: FOTO-GRAMA / <centro de costos> / <caja> / archivo
    const fId1 = await getOrCreateFolder(drive, carpeta1, rootId);
    const fId2 = await getOrCreateFolder(drive, carpeta2, fId1);

    const uploaded = await drive.files.create({
      requestBody: { name: fileName, parents: [fId2] },
      media: { mimeType, body: Readable.from(Buffer.from(base64, "base64")) },
      fields: "id,webViewLink",
      ...DRIVES,
    });

    // No se comparte públicamente: al estar en la unidad compartida, el
    // archivo hereda sus permisos y lo ve el equipo que ya tiene acceso.
    return NextResponse.json({
      id: uploaded.data.id,
      url: uploaded.data.webViewLink,
    });
  } catch (e) {
    console.error("Drive upload error:", e);
    const msg = (e as Error).message;
    const amigable = /File not found/i.test(msg)
      ? "No se encontró la carpeta de Drive. Verifica GOOGLE_DRIVE_FOLDER_ID y que esté compartida con la cuenta de servicio."
      : /permission|forbidden/i.test(msg)
      ? "La cuenta de servicio no tiene permiso de escritura en la carpeta de Drive."
      : /storage quota|quotaExceeded/i.test(msg)
      ? "La unidad de Drive no tiene espacio disponible."
      : msg;
    return NextResponse.json({ error: amigable }, { status: 500 });
  }
}

async function getOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  nombre: string,
  parentId: string
): Promise<string> {
  const limpio = nombre.replace(/'/g, "\\'");
  const q = `mimeType='application/vnd.google-apps.folder' and name='${limpio}' and '${parentId}' in parents and trashed=false`;

  const res = await drive.files.list({
    q, fields: "files(id)", pageSize: 1, ...DRIVES,
  });
  if (res.data.files?.length) return res.data.files[0].id!;

  const created = await drive.files.create({
    requestBody: {
      name: nombre,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    ...DRIVES,
  });
  return created.data.id!;
}
