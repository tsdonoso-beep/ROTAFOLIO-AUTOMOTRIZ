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

/**
 * Normaliza la clave privada de la cuenta de servicio.
 *
 * Llega de tres formas según de dónde se copie, y las tres son correctas para
 * quien las pega: con los saltos escritos como \n literal (que es como vive
 * en un archivo .env), con saltos de verdad (como sale del JSON de Google), y
 * entre comillas (que en un .env las quita el lector, pero en un secreto de
 * GitHub o de Vercel pasan a ser parte del valor).
 *
 * Google rechaza la clave con comillas y el error no dice que sobren: habla
 * de formato inválido. Costaba una tarde averiguarlo y cuesta tres líneas
 * evitarlo.
 */
export function normalizarClavePrivada(bruta: string | undefined): string | undefined {
  if (!bruta) return undefined;

  let k = bruta.trim();

  // Google entrega la clave dentro de un archivo .json, y sacar de ahí el
  // trozo exacto sin cortarlo de más es el paso donde todo el mundo se
  // equivoca. Si lo que llega es ese archivo entero, se saca la clave sola.
  if (k.startsWith("{")) {
    try {
      const j = JSON.parse(k) as { private_key?: unknown };
      if (typeof j.private_key === "string" && j.private_key.includes("PRIVATE KEY")) {
        k = j.private_key;
      }
    } catch {
      // No era JSON válido: se sigue tratando como una clave suelta, y si
      // tampoco lo es, Google lo dirá.
    }
  }
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  k = k.replace(/\\n/g, "\n");

  // El salto final no es decorativo: hay lectores de PEM que sin él no
  // reconocen la clave, y recortarlo al limpiar espacios es fácil de hacer
  // sin darse cuenta.
  return k.endsWith("\n") ? k : k + "\n";
}

/**
 * El correo de la cuenta de servicio.
 *
 * Si la clave se pegó como el archivo .json completo, el correo viene dentro
 * y no hace falta ponerlo aparte: son dos secretos menos que copiar mal.
 */
export function correoDeServicio(
  correo: string | undefined, clave: string | undefined
): string | undefined {
  const c = correo?.trim();
  if (c) return c;

  const k = clave?.trim();
  if (!k?.startsWith("{")) return undefined;
  try {
    const j = JSON.parse(k) as { client_email?: unknown };
    return typeof j.client_email === "string" ? j.client_email : undefined;
  } catch {
    return undefined;
  }
}

export function conectarDrive(): { drive: Drive; raiz: string } {
  const email = correoDeServicio(
    process.env.GOOGLE_SA_EMAIL, process.env.GOOGLE_SA_PRIVATE_KEY,
  );
  const key = normalizarClavePrivada(process.env.GOOGLE_SA_PRIVATE_KEY);
  const raiz = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();

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

/** Lo que Drive llama a una hoja nativa de Google. */
export const HOJA_DE_CALCULO = "application/vnd.google-apps.spreadsheet";

/**
 * Publica un CSV como hoja nativa de Google, no como archivo adjunto.
 *
 * Drive hace la conversión si se le pide ese mimeType al crear; alcanza con
 * el permiso de Drive que ya tiene la cuenta de servicio, sin sumar el de
 * Sheets.
 *
 * Reescribe siempre el mismo archivo cuando ya existe. Es la diferencia
 * entre un enlace que Contabilidad guarda una vez y otro que cambia cada mes
 * y hay que volver a repartir. Verificado: el identificador y el enlace
 * sobreviven a la reescritura.
 *
 * La contrapartida de reescribir es que se pisa lo que alguien haya escrito
 * encima. Por eso esta hoja es la fuente y no el cuaderno de trabajo: quien
 * quiera anotar sobre ella que la traiga con IMPORTRANGE a la suya.
 */
export async function publicarHoja(p: {
  csv: string;
  nombre: string;
  carpetas: string[];
}): Promise<{ id: string; url: string; reemplazada: boolean }> {
  const { drive, raiz } = conectarDrive();
  const destino = await asegurarRuta(drive, p.carpetas, raiz);
  // El BOM es lo que hace que Drive lea las tildes como UTF-8.
  const cuerpo = () => Readable.from(Buffer.from("\uFEFF" + p.csv, "utf8"));

  const previo = await buscarPorNombre(drive, p.nombre, destino);
  if (previo) {
    const act = await drive.files.update({
      fileId: previo,
      media: { mimeType: "text/csv", body: cuerpo() },
      fields: "id,webViewLink", ...DRIVES,
    });
    return { id: act.data.id!, url: act.data.webViewLink!, reemplazada: true };
  }

  const nueva = await drive.files.create({
    requestBody: { name: p.nombre, parents: [destino], mimeType: HOJA_DE_CALCULO },
    media: { mimeType: "text/csv", body: cuerpo() },
    fields: "id,webViewLink", ...DRIVES,
  });
  return { id: nueva.data.id!, url: nueva.data.webViewLink!, reemplazada: false };
}

/**
 * Da acceso de lectura a un archivo.
 *
 * Solo lectura: esta hoja se reescribe en cada publicación, así que lo que
 * alguien editara encima se perdería. Quien necesite anotar sobre ella que la
 * traiga a la suya con IMPORTRANGE.
 *
 * No manda correo. El aviso lo da quien reparte el enlace, que sabe explicar
 * qué es; una notificación de Drive sin contexto se archiva sin abrirse.
 *
 * Devuelve a quién se le dio y a quién no, en vez de cortar al primer fallo:
 * si un correo está mal escrito, el resto igual debe quedar con acceso.
 */
export async function darLectura(
  fileId: string, correos: string[]
): Promise<{ ok: string[]; fallaron: Array<{ correo: string; motivo: string }> }> {
  const { drive } = conectarDrive();
  const ok: string[] = [];
  const fallaron: Array<{ correo: string; motivo: string }> = [];

  for (const correo of correos) {
    try {
      await drive.permissions.create({
        fileId,
        requestBody: { type: "user", role: "reader", emailAddress: correo },
        sendNotificationEmail: false,
        ...DRIVES,
      });
      ok.push(correo);
    } catch (e) {
      fallaron.push({ correo, motivo: e instanceof Error ? e.message : String(e) });
    }
  }

  return { ok, fallaron };
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
