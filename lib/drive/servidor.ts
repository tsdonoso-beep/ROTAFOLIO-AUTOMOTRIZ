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
import {
  anchoMaximo, elegirPestana, enBloques, rangoA1, type Pestana,
} from "./rangos.ts";
import { aTabla, columnasDeFecha } from "./celdas.ts";
import type { TipoColumna } from "../export/comprobantes-sunat.ts";

const DRIVES = { supportsAllDrives: true, includeItemsFromAllDrives: true };

export type Drive = ReturnType<typeof google.drive>;
export type Hojas = ReturnType<typeof google.sheets>;

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

export function conectarDrive(): { drive: Drive; hojas: Hojas; raiz: string } {
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
    // Drive para encontrar y crear el archivo; Sheets para escribir dentro
    // de una pestaña sin tocar las demás.
    scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });
  return {
    drive: google.drive({ version: "v3", auth }),
    hojas: google.sheets({ version: "v4", auth }),
    raiz,
  };
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
 * Cuántas filas se mandan por petición.
 *
 * No hay un número publicado: hay un límite de tamaño de petición, y trece
 * mil filas de veintiún columnas lo pasan. Cinco mil entra con holgura y son
 * tres viajes en vez de uno; el tiempo que cuesta es menos que el de
 * averiguar por qué falló.
 */
const FILAS_POR_ENVIO = 5000;

/**
 * Publica las filas como hoja nativa de Google.
 *
 * Escribe SOLO dentro de la pestaña de datos —la que se llama como el
 * archivo—, con la API de Sheets. Antes se reescribía el archivo entero, que
 * era más simple y era un error: Contabilidad instaló su tablero como una
 * segunda pestaña del mismo archivo —que es lo natural, y es lo que cualquiera
 * va a hacer— y la publicación siguiente se lo habría borrado sin avisar. Lo
 * que está fuera de la pestaña de datos ahora no se toca: otras pestañas, el
 * script que les cuelga, los formatos, los anchos de columna.
 *
 * El identificador y el enlace no cambian nunca: es la diferencia entre un
 * enlace que se reparte una vez y otro que hay que volver a repartir cada mes.
 *
 * `tipos` dice qué contiene cada columna. Sin eso la hoja adivina, y adivina
 * mal: ver el comentario de TIPOS_SUNAT.
 */
export async function publicarHoja(p: {
  filas: string[][];
  nombre: string;
  carpetas: string[];
  tipos?: TipoColumna[];
}): Promise<{ id: string; url: string; reemplazada: boolean }> {
  const { drive, hojas, raiz } = conectarDrive();
  const destino = await asegurarRuta(drive, p.carpetas, raiz);

  const previo = await buscarPorNombre(drive, p.nombre, destino);
  const id = previo ?? await crearHojaVacia(drive, hojas, p.nombre, destino);

  await escribirPestana(hojas, id, p.nombre, p.filas, p.tipos ?? []);

  const info = await drive.files.get({ fileId: id, fields: "id,webViewLink", ...DRIVES });
  return { id: info.data.id!, url: info.data.webViewLink!, reemplazada: previo !== null };
}

/**
 * Crea la hoja vacía y le pone a la pestaña el nombre del archivo.
 *
 * Se crea vacía y se llena después, en vez de convertir un CSV al crear: así
 * la primera publicación escribe exactamente igual que todas las demás, con
 * los mismos tipos de celda. Antes la primera vez pasaba por CSV y las
 * siguientes no, que es la clase de diferencia que se descubre meses después.
 *
 * El nombre de la pestaña importa: es por donde la vuelve a encontrar la
 * publicación del día siguiente.
 */
async function crearHojaVacia(
  drive: Drive, hojas: Hojas, nombre: string, destino: string
): Promise<string> {
  const nueva = await drive.files.create({
    requestBody: { name: nombre, parents: [destino], mimeType: HOJA_DE_CALCULO },
    fields: "id", ...DRIVES,
  });
  const id = nueva.data.id!;

  const meta = await hojas.spreadsheets.get({
    spreadsheetId: id, fields: "sheets(properties(sheetId))",
  });
  await hojas.spreadsheets.batchUpdate({
    spreadsheetId: id,
    requestBody: {
      requests: [{
        updateSheetProperties: {
          properties: { sheetId: meta.data.sheets?.[0]?.properties?.sheetId ?? 0, title: nombre },
          fields: "title",
        },
      }],
    },
  });
  return id;
}

/**
 * Reemplaza el contenido de una pestaña, y solo de esa.
 *
 * Primero agranda la cuadrícula si hace falta —Sheets rechaza escribir más
 * allá del borde en vez de crecer solo—, después borra lo que había y
 * después escribe. El borrado va antes y no después: si el mes nuevo trae
 * menos comprobantes que el anterior, sin borrar quedarían filas viejas
 * colgando debajo de las nuevas, que es peor que una hoja vacía porque
 * parece correcta.
 */
export async function escribirPestana(
  hojas: Hojas, hojaId: string, nombre: string, filas: string[][], tipos: TipoColumna[]
): Promise<void> {
  const meta = await hojas.spreadsheets.get({
    spreadsheetId: hojaId,
    fields: "sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
  });

  const pestanas: Pestana[] = (meta.data.sheets ?? []).map(s => ({
    id: s.properties?.sheetId ?? 0,
    titulo: s.properties?.title ?? "",
    filas: s.properties?.gridProperties?.rowCount ?? 0,
    columnas: s.properties?.gridProperties?.columnCount ?? 0,
  }));
  const pestana = elegirPestana(pestanas, nombre);

  const anchoNecesario = Math.max(anchoMaximo(filas), 1);
  const altoNecesario = Math.max(filas.length, 1);
  if (pestana.filas < altoNecesario || pestana.columnas < anchoNecesario) {
    await hojas.spreadsheets.batchUpdate({
      spreadsheetId: hojaId,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: {
              sheetId: pestana.id,
              gridProperties: {
                rowCount: Math.max(pestana.filas, altoNecesario),
                columnCount: Math.max(pestana.columnas, anchoNecesario),
              },
            },
            fields: "gridProperties.rowCount,gridProperties.columnCount",
          },
        }],
      },
    });
  }

  await hojas.spreadsheets.values.clear({
    spreadsheetId: hojaId,
    range: rangoA1(
      pestana.titulo, 1,
      Math.max(pestana.filas, altoNecesario),
      Math.max(pestana.columnas, anchoNecesario),
    ),
    requestBody: {},
  });

  // Las columnas de fecha llevan números de día, que sin formato se ven como
  // 45987. Va junto con la cabecera fija y en negrita, todo antes de
  // escribir: son formatos, no dependen de los datos que vienen.
  const fechas = columnasDeFecha(tipos);
  await hojas.spreadsheets.batchUpdate({
    spreadsheetId: hojaId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId: pestana.id, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
        {
          repeatCell: {
            range: { sheetId: pestana.id, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.92, green: 0.94, blue: 0.96 },
              },
            },
            fields: "userEnteredFormat(textFormat,backgroundColor)",
          },
        },
        ...fechas.map(c => ({
          repeatCell: {
            range: {
              sheetId: pestana.id,
              startRowIndex: 1,          // la cabecera es texto y se deja
              startColumnIndex: c, endColumnIndex: c + 1,
            },
            cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" } } },
            fields: "userEnteredFormat.numberFormat",
          },
        })),
      ],
    },
  });

  const tabla = aTabla(filas, tipos);
  for (const bloque of enBloques(tabla, FILAS_POR_ENVIO)) {
    await hojas.spreadsheets.values.update({
      spreadsheetId: hojaId,
      range: rangoA1(pestana.titulo, bloque.desde, bloque.filas.length, anchoNecesario),
      // RAW y no USER_ENTERED: cada celda ya viene con su tipo decidido, y lo
      // que queda por hacer es que la hoja no lo vuelva a interpretar.
      valueInputOption: "RAW",
      requestBody: { values: bloque.filas },
    });
  }

  // El ancho de columna se ajusta DESPUÉS de escribir: se basa en el
  // contenido real, y antes de escribir todavía no lo hay.
  await hojas.spreadsheets.batchUpdate({
    spreadsheetId: hojaId,
    requestBody: {
      requests: [{
        autoResizeDimensions: {
          dimensions: { sheetId: pestana.id, dimension: "COLUMNS", startIndex: 0, endIndex: anchoNecesario },
        },
      }],
    },
  });
}

/**
 * Da acceso de lectura a un archivo.
 *
 * Solo lectura: la pestaña de datos se reescribe en cada publicación, así que
 * lo que alguien editara encima se perdería. Quien necesite anotar que lo haga
 * en otra pestaña —esas la publicación no las toca— o en su propia hoja.
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
  // Este falla una sola vez en la vida del proyecto, el día que se empieza a
  // escribir por pestaña, y el mensaje de Google es una pared de texto con la
  // URL enterrada en el medio.
  if (/Google Sheets API has not been used|sheets\.googleapis\.com.*disabled/i.test(msg)) {
    return "Falta habilitar la API de Google Sheets en el proyecto de Google Cloud (APIs y servicios → Habilitar API → Google Sheets API). La de Drive ya está.";
  }
  return msg;
}
