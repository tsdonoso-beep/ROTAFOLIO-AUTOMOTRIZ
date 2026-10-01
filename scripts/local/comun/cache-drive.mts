// Qué archivos tiene cada carpeta de Drive, leído UNA vez por carpeta y consultado en memoria.
//
// Antes, por cada archivo se preguntaba a Drive «¿ya existe este nombre?» y
// después se subía: dos llamadas por archivo, y Drive era el cuello de botella
// de la tubería (~80 comprobantes/min el 30/09/2026, contra ~470/min de
// SUNAT). Ahora se lista la carpeta una sola vez (de a 1000) y cada archivo
// cuesta una llamada (la subida), o ninguna si ya estaba.

export type Listar = (carpetaId: string) => Promise<Map<string, string | null>>;
export type Crear = (carpetaId: string, nombre: string) => Promise<string | null>;

export class CacheCarpetas {
  private carpetas = new Map<string, Promise<Map<string, string | null>>>();
  private enCurso = new Map<string, Promise<string | null>>();
  private listar: Listar;
  private crear: Crear;
  llamadasListar = 0;

  constructor(listar: Listar, crear: Crear) {
    this.listar = listar;
    this.crear = crear;
  }

  private contenido(carpetaId: string) {
    let pr = this.carpetas.get(carpetaId);
    if (!pr) {
      this.llamadasListar++;
      pr = this.listar(carpetaId);
      // Si listar falla, se olvida: el próximo archivo de esa carpeta lo reintenta.
      pr.catch(() => this.carpetas.delete(carpetaId));
      this.carpetas.set(carpetaId, pr);
    }
    return pr;
  }

  /**
   * Sube si el nombre no está en la carpeta; si ya estaba, devuelve su enlace.
   * Dos pedidos simultáneos del mismo nombre esperan a la misma subida (no se
   * duplica en Drive). Si la subida falla, el nombre queda libre para reintentar.
   */
  async subir(carpetaId: string, nombre: string): Promise<{ estado: "nuevo" | "existe"; url: string | null }> {
    const archivos = await this.contenido(carpetaId);
    if (archivos.has(nombre)) return { estado: "existe", url: archivos.get(nombre) ?? null };
    const clave = `${carpetaId}/${nombre}`;
    const ya = this.enCurso.get(clave);
    if (ya) return { estado: "existe", url: await ya };
    const pr = this.crear(carpetaId, nombre);
    this.enCurso.set(clave, pr);
    try {
      const url = await pr;
      archivos.set(nombre, url);
      return { estado: "nuevo", url };
    } finally {
      this.enCurso.delete(clave);
    }
  }
}

/** Lo mínimo del cliente de Drive (googleapis) que necesita el subidor. */
interface DriveMin {
  files: {
    list(
      p: Record<string, unknown>,
    ): Promise<{ data: { files?: Array<{ name?: string | null; webViewLink?: string | null }>; nextPageToken?: string | null } }>;
    create(p: Record<string, unknown>): Promise<{ data: { webViewLink?: string | null } }>;
  };
}
export interface ArchivoASubir {
  nombre: string;
  datos: Buffer;
  tipo: string;
}

/**
 * subir(carpetaId, archivo) con la carpeta listada una sola vez. Para los
 * scripts que ya tienen su propio cliente de Drive (descargar-cpe,
 * consultar-cpe-individual): reemplaza su «list por archivo + create».
 */
export function crearSubidor(drive: DriveMin) {
  const DRIVES = { supportsAllDrives: true, includeItemsFromAllDrives: true };
  const porSubir = new Map<string, ArchivoASubir>();
  const cache = new CacheCarpetas(
    async carpetaId => {
      const m = new Map<string, string | null>();
      let pageToken: string | undefined;
      do {
        const r = await drive.files.list({
          q: `'${carpetaId}' in parents and trashed = false`,
          fields: "nextPageToken, files(name,webViewLink)",
          pageSize: 1000,
          pageToken,
          ...DRIVES,
        });
        for (const a of r.data.files ?? []) if (a.name) m.set(a.name, a.webViewLink ?? null);
        pageToken = r.data.nextPageToken ?? undefined;
      } while (pageToken);
      return m;
    },
    async (carpetaId, nombre) => {
      const f = porSubir.get(`${carpetaId}/${nombre}`)!;
      const { Readable } = await import("node:stream");
      const creado = await drive.files.create({
        requestBody: { name: f.nombre, parents: [carpetaId] },
        media: { mimeType: f.tipo, body: Readable.from(f.datos) },
        fields: "id,webViewLink",
        supportsAllDrives: true,
      });
      return creado.data.webViewLink ?? null;
    },
  );
  return async (carpetaId: string, f: ArchivoASubir) => {
    const k = `${carpetaId}/${f.nombre}`;
    porSubir.set(k, f);
    try {
      return await cache.subir(carpetaId, f.nombre);
    } finally {
      porSubir.delete(k);
    }
  };
}
