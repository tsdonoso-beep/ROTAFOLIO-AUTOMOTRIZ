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
    const { base64, mimeType, fileName, carpetas, reemplazar } = (await req.json()) as {
      base64: string;
      mimeType: string;
      fileName: string;
      /** Ruta desde la raíz: empresa / período / centro de costo / memo. */
      carpetas: string[];
      /**
       * Si ya hay un archivo con ese nombre en la carpeta, reemplaza su
       * contenido en vez de crear otro. Es lo que necesita el resumen del
       * memo, que se regenera cada vez que el expediente cambia: sin esto
       * quedarían veinte copias del mismo archivo.
       */
      reemplazar?: boolean;
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

    // FOTO-GRAMA / empresa / AAAA-MM / centro de costo / memo / archivo.
    // Se crea nivel por nivel: Drive no entiende de rutas, solo de padres.
    const destino = await asegurarRuta(drive, carpetas, rootId);
    const cuerpo = () => Readable.from(Buffer.from(base64, "base64"));

    if (reemplazar) {
      const previo = await buscarPorNombre(drive, fileName, destino);
      if (previo) {
        const act = await drive.files.update({
          fileId: previo,
          media: { mimeType, body: cuerpo() },
          fields: "id,webViewLink",
          ...DRIVES,
        });
        return NextResponse.json({ id: act.data.id, url: act.data.webViewLink, reemplazado: true });
      }
    }

    const uploaded = await drive.files.create({
      requestBody: { name: fileName, parents: [destino] },
      media: { mimeType, body: cuerpo() },
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

/**
 * Mueve un archivo ya subido a otra carpeta.
 *
 * Un comprobante capturado sin memo se archiva en una carpeta de
 * pendientes: la foto solo vive en la memoria del navegador y se perdería
 * al cerrar. Cuando después se le asigna un memo, el archivo tiene que
 * viajar a la carpeta que le corresponde, porque la trazabilidad por
 * centro de costo y memo es justamente lo que se usa para auditar.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { fileId, carpetas } = (await req.json()) as {
      fileId: string; carpetas: string[];
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

    const destino = await asegurarRuta(drive, carpetas, rootId);

    // Hay que saber de dónde sale para poder quitarlo de ahí: Drive maneja
    // los padres como una lista, no como una ruta única.
    const actual = await drive.files.get({
      fileId, fields: "parents", ...DRIVES,
    });
    const padres = actual.data.parents ?? [];

    const movido = await drive.files.update({
      fileId,
      addParents: destino,
      removeParents: padres.join(","),
      fields: "id,webViewLink",
      ...DRIVES,
    });

    return NextResponse.json({ id: movido.data.id, url: movido.data.webViewLink });
  } catch (e) {
    console.error("Drive move error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Crea la ruta completa desde la raíz y devuelve la carpeta final. */
async function asegurarRuta(
  drive: ReturnType<typeof google.drive>,
  carpetas: string[],
  rootId: string
): Promise<string> {
  let actual = rootId;
  for (const nombre of carpetas) {
    const limpio = (nombre ?? "").trim();
    if (!limpio) continue;
    actual = await getOrCreateFolder(drive, limpio, actual);
  }
  return actual;
}

async function buscarPorNombre(
  drive: ReturnType<typeof google.drive>,
  nombre: string,
  parentId: string
): Promise<string | null> {
  const limpio = nombre.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `name='${limpio}' and '${parentId}' in parents and trashed=false`,
    fields: "files(id)", pageSize: 1, ...DRIVES,
  });
  return res.data.files?.[0]?.id ?? null;
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
