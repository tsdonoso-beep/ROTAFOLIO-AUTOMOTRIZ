// Escritura en Drive, del lado del servidor
//
// Vive acá y no en la ruta de API para que también lo pueda usar una acción
// del servidor: una acción no puede hacer fetch a su propia aplicación sin
// inventarse una URL absoluta, y esa URL cambia entre local, vista previa y
// producción.
//
// La carpeta de destino está en una unidad compartida. La API de Drive las
// ignora salvo que se le pasen estos parámetros en CADA llamada; sin ellos
// responde "File not found" aunque la carpeta exista y la cuenta de
// servicio tenga permisos.

import { google } from "googleapis";
import { Readable } from "stream";

const DRIVES = { supportsAllDrives: true, includeItemsFromAllDrives: true };

export type Drive = ReturnType<typeof google.drive>;

export function conectarDrive(): { drive: Drive; raiz: string } {
  const email = process.env.GOOGLE_SA_EMAIL;
  const key = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const raiz = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!email || !key || !raiz) {
    throw new Error("Credenciales de Drive no configuradas en el servidor.");
  }

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return { drive: google.drive({ version: "v3", auth }), raiz };
}

/** Crea la ruta completa desde la raíz y devuelve la carpeta final. */
export async function asegurarRuta(
  drive: Drive, carpetas: string[], raiz: string
): Promise<string> {
  let actual = raiz;
  for (const nombre of carpetas) {
    const limpio = (nombre ?? "").trim();
    if (!limpio) continue;
    actual = await carpeta(drive, limpio, actual);
  }
  return actual;
}

export async function carpeta(drive: Drive, nombre: string, padre: string): Promise<string> {
  const limpio = nombre.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${limpio}' and '${padre}' in parents and trashed=false`,
    fields: "files(id)", pageSize: 1, ...DRIVES,
  });
  if (res.data.files?.length) return res.data.files[0].id!;

  const creada = await drive.files.create({
    requestBody: { name: nombre, mimeType: "application/vnd.google-apps.folder", parents: [padre] },
    fields: "id", ...DRIVES,
  });
  return creada.data.id!;
}

export async function buscarPorNombre(
  drive: Drive, nombre: string, padre: string
): Promise<string | null> {
  const limpio = nombre.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `name='${limpio}' and '${padre}' in parents and trashed=false`,
    fields: "files(id)", pageSize: 1, ...DRIVES,
  });
  return res.data.files?.[0]?.id ?? null;
}

/**
 * Sube un archivo. Con `reemplazar`, si ya existe uno con ese nombre en la
 * carpeta actualiza su contenido en vez de crear otro: es lo que necesita
 * el resumen del memo, que se regenera cada vez que el expediente cambia.
 */
export async function subir(p: {
  contenido: Buffer;
  mimeType: string;
  nombre: string;
  carpetas: string[];
  reemplazar?: boolean;
}): Promise<{ id: string; url: string; reemplazado: boolean }> {
  const { drive, raiz } = conectarDrive();
  const destino = await asegurarRuta(drive, p.carpetas, raiz);

  if (p.reemplazar) {
    const previo = await buscarPorNombre(drive, p.nombre, destino);
    if (previo) {
      const act = await drive.files.update({
        fileId: previo,
        media: { mimeType: p.mimeType, body: Readable.from(p.contenido) },
        fields: "id,webViewLink", ...DRIVES,
      });
      return { id: act.data.id!, url: act.data.webViewLink!, reemplazado: true };
    }
  }

  const nuevo = await drive.files.create({
    requestBody: { name: p.nombre, parents: [destino] },
    media: { mimeType: p.mimeType, body: Readable.from(p.contenido) },
    fields: "id,webViewLink", ...DRIVES,
  });
  return { id: nuevo.data.id!, url: nuevo.data.webViewLink!, reemplazado: false };
}

/** Traduce los fallos de Drive a algo que quien lo lea pueda accionar. */
export function explicarFallo(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/File not found/i.test(msg)) {
    return "No se encontró la carpeta de Drive. Verifica GOOGLE_DRIVE_FOLDER_ID y que esté compartida con la cuenta de servicio.";
  }
  if (/permission|forbidden/i.test(msg)) {
    return "La cuenta de servicio no tiene permiso de escritura en la carpeta de Drive.";
  }
  if (/storage quota|quotaExceeded/i.test(msg)) {
    return "La unidad de Drive no tiene espacio disponible.";
  }
  return msg;
}
