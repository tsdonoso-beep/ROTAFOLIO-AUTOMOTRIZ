// Una respuesta de verdad del SIRE, del ticket que generó la propuesta del
// RCE de INROPRIN para el período 202608.
//
// Se guarda porque contiene dos cosas que ningún ejemplo inventado habría
// tenido: SUNAT escribe «codTipoAchivoReporte» sin la erre, y manda
// `detalleTicket` como objeto donde otros servicios mandan un arreglo. Las
// dos juntas hacían que el tipo de archivo saliera vacío y que la descarga
// respondiera HTTP 500 sin decir por qué.
//
// El RUC es el de INROPRIN y el resto son datos de un proceso ya terminado;
// no hay nada secreto acá.

export const TICKET_PROPUESTA_RCE = {
  showReporteDescarga: "1",
  perTributario: "202608",
  numTicket: "20260300000112",
  fecCargaImportacion: null,
  fecInicioProceso: "2026-09-12",
  codProceso: "10",
  desProceso: "Generar archivo exportar propuesta",
  codEstadoProceso: "06",
  desEstadoProceso: "Terminado",
  nomArchivoImportacion: null,
  detalleTicket: {
    numTicket: "20260300000112",
    fecCargaImportacion: "2026-09-12",
    horaCargaImportacion: "21:25:08",
    codEstadoEnvio: "06",
    desEstadoEnvio: "Terminado",
    nomArchivoReporte: null,
    cntFilasvalidada: 0,
    cntCPError: 0,
    cntCPInformados: 0,
  },
  archivoReporte: [
    {
      codTipoAchivoReporte: "00",
      nomArchivoReporte: "20512201611-20260912-212509-propuesta.zip",
      nomArchivoContenido: "20512201611-20260912-2125-propuesta.csv",
    },
  ],
  subProcesos: [
    { codTipoSubProceso: "", desTipoSubProceso: "", codEstado: "1", numIntentos: 1 },
  ],
};
