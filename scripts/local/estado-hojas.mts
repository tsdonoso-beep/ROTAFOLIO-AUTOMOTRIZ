// Estado de las hojas publicadas en Drive (GOOGLE_DRIVE_FOLDER_ID/SUNAT/), leídas con la cuenta de servicio.
//
//   pnpm cpe:hojas
//
// Por cada hoja: cuándo se modificó, filas y columnas, y un conteo por
// período (de la columna que parezca período o fecha de emisión).

import { google } from "googleapis";
import "./comun/config.mts"; // carga la clave desde GOOGLE_SA_KEY_FILE
import { normalizarClavePrivada, correoDeServicio } from "../../lib/drive/servidor.ts";

const email = correoDeServicio(process.env.GOOGLE_SA_EMAIL, process.env.GOOGLE_SA_PRIVATE_KEY);
const key = normalizarClavePrivada(process.env.GOOGLE_SA_PRIVATE_KEY);
const raiz = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
if (!email || !key || !raiz) {
  console.error("✗ Faltan GOOGLE_SA_EMAIL / clave / GOOGLE_DRIVE_FOLDER_ID.");
  process.exit(1);
}

const auth = new google.auth.JWT({
  email,
  key,
  scopes: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const drive = google.drive({ version: "v3", auth });
const sheets = google.sheets({ version: "v4", auth });
const DRIVES = { supportsAllDrives: true, includeItemsFromAllDrives: true } as const;

const sub = await drive.files.list({
  q: `mimeType='application/vnd.google-apps.folder' and name='SUNAT' and '${raiz}' in parents and trashed=false`,
  fields: "files(id)",
  ...DRIVES,
});
const carpetaSunat = sub.data.files?.[0]?.id;
if (!carpetaSunat) {
  console.error("✗ No hay carpeta SUNAT dentro de GOOGLE_DRIVE_FOLDER_ID.");
  process.exit(1);
}

const hojas = await drive.files.list({
  q: `mimeType='application/vnd.google-apps.spreadsheet' and '${carpetaSunat}' in parents and trashed=false`,
  fields: "files(id,name,modifiedTime,webViewLink)",
  orderBy: "name",
  ...DRIVES,
});

for (const h of hojas.data.files ?? []) {
  console.log(`\n■ ${h.name}  (modificada ${h.modifiedTime})\n  ${h.webViewLink}`);
  const meta = await sheets.spreadsheets.get({ spreadsheetId: h.id!, fields: "sheets(properties(title,gridProperties))" });
  for (const s of meta.data.sheets ?? [])
    console.log(
      `  · pestaña «${s.properties?.title}»: ${s.properties?.gridProperties?.rowCount} filas × ${s.properties?.gridProperties?.columnCount} columnas (tamaño de grilla)`,
    );
  const primera = meta.data.sheets?.[0]?.properties?.title;
  if (!primera) continue;
  const v = await sheets.spreadsheets.values.get({ spreadsheetId: h.id!, range: `'${primera}'` });
  const filas = v.data.values ?? [];
  const cab = (filas[0] ?? []).map(String);
  console.log(`  · datos en «${primera}»: ${Math.max(filas.length - 1, 0)} filas`);
  console.log(`  · columnas: ${cab.join(" | ")}`);
  const iPer = cab.findIndex(c => /per[ií]odo/i.test(c));
  const iFecha = cab.findIndex(c => /fecha.*emisi/i.test(c));
  const iSerie = cab.findIndex(c => /^serie/i.test(c));
  const col = iPer >= 0 ? iPer : iFecha;
  if (col < 0) continue;
  const conteo = new Map<string, { filas: number; noE: number }>();
  for (const f of filas.slice(1)) {
    const bruto = String(f[col] ?? "");
    const iso = bruto.match(/(\d{4})-(\d{2})/);
    const dmy = bruto.match(/\d{2}\/(\d{2})\/(\d{4})/);
    const per = iPer >= 0 ? bruto.replace(/\D/g, "").slice(0, 6) : iso ? `${iso[1]}${iso[2]}` : dmy ? `${dmy[2]}${dmy[1]}` : "?";
    const r = conteo.get(per) ?? { filas: 0, noE: 0 };
    r.filas++;
    if (iSerie >= 0 && !/^E/i.test(String(f[iSerie] ?? ""))) r.noE++;
    conteo.set(per, r);
  }
  console.log(`  · por período (${cab[col]}):${iSerie >= 0 ? " filas / de ellas serie no-E" : ""}`);
  for (const [p, r] of [...conteo.entries()].sort()) console.log(`     ${p}: ${r.filas}${iSerie >= 0 ? ` / ${r.noE}` : ""}`);
}
