import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { Readable } from "stream";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { base64, mimeType, fileName, carpeta1, carpeta2 } = body as {
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

    // Obtiene o crea carpeta nivel 1 (centro de costos)
    const fId1 = await getOrCreateFolder(drive, carpeta1, rootId);
    // Obtiene o crea carpeta nivel 2 (caja)
    const fId2 = await getOrCreateFolder(drive, carpeta2, fId1);

    // Sube el archivo
    const buffer = Buffer.from(base64, "base64");
    const stream = Readable.from(buffer);

    const uploaded = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [fId2],
      },
      media: { mimeType, body: stream },
      fields: "id,webViewLink",
    });

    // Hacer el archivo visible (lector público)
    await drive.permissions.create({
      fileId: uploaded.data.id!,
      requestBody: { role: "reader", type: "anyone" },
    });

    return NextResponse.json({
      id: uploaded.data.id,
      url: uploaded.data.webViewLink,
    });
  } catch (e) {
    console.error("Drive upload error:", e);
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}

async function getOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  nombre: string,
  parentId: string
): Promise<string> {
  const q = `mimeType='application/vnd.google-apps.folder' and name='${nombre.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false`;
  const res = await drive.files.list({ q, fields: "files(id)", pageSize: 1 });
  if (res.data.files?.length) return res.data.files[0].id!;

  const created = await drive.files.create({
    requestBody: {
      name: nombre,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });
  return created.data.id!;
}
