export async function subirADrive(params: {
  base64: string;
  mimeType: string;
  fileName: string;
  centroCostos: string;
  caja: string;
}): Promise<{ id: string; url: string }> {
  const res = await fetch("/api/drive-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      base64: params.base64,
      mimeType: params.mimeType,
      fileName: params.fileName,
      carpeta1: params.centroCostos,
      carpeta2: params.caja,
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Error subiendo a Drive");
  }

  return res.json();
}
