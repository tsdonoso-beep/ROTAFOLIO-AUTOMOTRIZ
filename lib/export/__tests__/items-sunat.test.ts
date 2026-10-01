import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  filasItemsSunat, filaDetalleDesdeRpc, CABECERAS_ITEMS, TIPOS_ITEMS, nombreArchivoItems, detalleCpeCompleto, type FilaDetalleCpe,
} from "../items-sunat.ts";

function fila(over: Partial<FilaDetalleCpe> = {}): FilaDetalleCpe {
  return {
    periodo: "202608", origen: "RECIBIDO", proveedorRuc: "20111111111",
    proveedorNombre: "PROVEEDOR SAC", tipoComprobante: "01", serie: "F001",
    numero: "123", fechaEmision: "2026-08-27", moneda: "PEN", linea: 1,
    descripcion: "RESINA ABS", cantidad: 250, unidad: "NIU",
    precioUnitario: 2.85, importe: 712.5, totalComprobante: 840.75,
    enlacePdf: "https://drive.google.com/file/d/pdf/view",
    enlaceXml: "https://drive.google.com/file/d/xml/view",
    formaPago: "Credito", guiaRemision: "T001-1", ordenCompra: "OC-9",
    documentoRelacionado: "F001-9", tipoDocumentoRelacionado: "ANTICIPO", anticipoAplicado: 500,
    detraccionPorcentaje: 12, detraccionMonto: 85.5,
    detraccionCuentaBanco: "00002003147", detraccionCodigoBienServicio: "037",
    ...over,
  };
}

describe("filasItemsSunat", () => {
  const filas = filasItemsSunat([fila()]);

  test("la primera fila son las cabeceras", () => {
    assert.deepEqual(filas[0], CABECERAS_ITEMS);
  });

  test("traduce el tipo y el origen a algo legible", () => {
    const r = filas[1];
    assert.equal(r[1], "Recibido");
    assert.equal(r[4], "Factura");
  });

  test("la fecha sale en formato español y la serie como texto", () => {
    const r = filas[1];
    assert.equal(r[7], "27/08/2026");
    assert.equal(r[5], "F001");
    assert.equal(r[6], "123");
  });

  test("el precio unitario lleva cuatro decimales; el importe, dos", () => {
    const r = filas[1];
    assert.equal(r[23], "2.8500");
    assert.equal(r[24], "712.50");
  });

  test("un importe ausente queda vacío, no en cero", () => {
    const r = filasItemsSunat([fila({ importe: null })])[1];
    assert.equal(r[24], "");
  });

  test("el PDF y el XML archivados en Drive van al final, PDF primero", () => {
    const r = filas[1];
    assert.equal(r[26], "https://drive.google.com/file/d/pdf/view");
    assert.equal(r[27], "https://drive.google.com/file/d/xml/view");
  });

  test("la OC de la carpeta, el centro de costo, el código CONCAR y el archivo que la confirma van después del XML", () => {
    const r = filasItemsSunat([fila({
      ocCarpeta: "0115-2026", centroCostoCg: "PROY-2025-079-5", codigoConcar: "30016",
      archivoOc: "FACTURA F001-18178.pdf", archivoOcUrl: "https://drive.google.com/file/d/xyz/view",
    })])[1];
    assert.deepEqual(r.slice(28, 33), [
      "0115-2026", "PROY-2025-079-5", "30016", "FACTURA F001-18178.pdf", "https://drive.google.com/file/d/xyz/view",
    ]);
    assert.equal(r.length, CABECERAS_ITEMS.length);
    assert.equal(CABECERAS_ITEMS.length, TIPOS_ITEMS.length);
  });

  test("sin OC vinculada, esas trece columnas quedan vacías", () => {
    assert.deepEqual(filasItemsSunat([fila()])[1].slice(28), ["", "", "", "", "", "", "", "", "", "", "", "", ""]);
  });

  test("lo de la carpeta madre (proyecto, de dónde sale el centro de costo, documentos) va al final", () => {
    const f = filaDetalleDesdeRpc({
      oc_carpeta: "0999-2026", proyecto_oc: "01) TALLERES ESPECIALIZADOS ",
      centro_costo_segun: "Su carpeta de proyecto (las demás OC, según CG)", documentos_oc: "Factura 1 · OC 1",
    });
    const r = filasItemsSunat([fila(f)])[1];
    assert.deepEqual(r.slice(38), [
      "01) TALLERES ESPECIALIZADOS", "Su carpeta de proyecto (las demás OC, según CG)", "Factura 1 · OC 1",
    ]);
    assert.deepEqual(CABECERAS_ITEMS.slice(36), [
      "Legajo de la OC", "Carpeta de la OC", "Proyecto de la OC", "Centro de costo según", "Documentos de la OC",
    ]);
  });

  test("el legajo de la OC va al final, y llega de detalle_cpe en snake_case", () => {
    const f = filaDetalleDesdeRpc({
      oc_carpeta: "0115-2026", situacion_pago_oc: "APROBADA, PAGO PENDIENTE", comprador_oc: "Omar Luque",
      area_oc: "COMEX (importaciones)", legajo_oc: "Completo", carpeta_oc_url: "https://drive.google.com/drive/folders/abc",
    });
    const r = filasItemsSunat([fila(f)])[1];
    assert.deepEqual(r.slice(33, 38), [
      "APROBADA, PAGO PENDIENTE", "Omar Luque", "COMEX (importaciones)", "Completo",
      "https://drive.google.com/drive/folders/abc",
    ]);
  });

  test("la fila cruda de detalle_cpe trae la OC en snake_case", () => {
    const f = filaDetalleDesdeRpc({
      oc_carpeta: "0115-2026", centro_costo_cg: "PROY-2025-079-5", codigo_concar: null,
      archivo_oc: "FACTURA F001-18178.pdf", archivo_oc_url: "https://drive.google.com/file/d/xyz/view",
    });
    assert.equal(f.ocCarpeta, "0115-2026");
    assert.equal(f.centroCostoCg, "PROY-2025-079-5");
    assert.equal(f.codigoConcar, null);
    assert.equal(f.archivoOc, "FACTURA F001-18178.pdf");
    assert.equal(f.archivoOcUrl, "https://drive.google.com/file/d/xyz/view");
  });

  test("sin enlace archivado queda vacío, no como texto 'null'", () => {
    const r = filasItemsSunat([fila({ enlacePdf: null, enlaceXml: null })])[1];
    assert.equal(r[26], "");
    assert.equal(r[27], "");
  });

  test("forma de pago, guía, OC, documento relacionado y anticipo van entre la moneda y las líneas", () => {
    const r = filas[1];
    assert.equal(r[9], "Credito");
    assert.equal(r[10], "T001-1");
    assert.equal(r[11], "OC-9");
    assert.equal(r[12], "F001-9");
    assert.equal(r[13], "ANTICIPO");
    assert.equal(r[14], "500.00");
  });

  test("la detracción trae porcentaje, monto, cuenta y código de bien/servicio", () => {
    const r = filas[1];
    assert.equal(r[15], "12.00");
    assert.equal(r[16], "85.50");
    assert.equal(r[17], "00002003147");
    assert.equal(r[18], "037");
  });

  test("sin detracción ni anticipo, los campos quedan vacíos, no en cero", () => {
    const r = filasItemsSunat([fila({
      formaPago: null, guiaRemision: null, ordenCompra: null,
      documentoRelacionado: null, tipoDocumentoRelacionado: null, anticipoAplicado: null,
      detraccionPorcentaje: null, detraccionMonto: null,
      detraccionCuentaBanco: null, detraccionCodigoBienServicio: null,
    })])[1];
    assert.equal(r[9], "");
    assert.equal(r[12], "");
    assert.equal(r[14], "");
    assert.equal(r[15], "");
    assert.equal(r[17], "");
    assert.equal(r[18], "");
  });
});

describe("nombreArchivoItems", () => {
  test("con y sin período, sin pisar el de cabeceras", () => {
    assert.equal(nombreArchivoItems(null), "COMPROBANTES SUNAT - DETALLE.csv");
    assert.equal(nombreArchivoItems("202608"), "COMPROBANTES SUNAT - DETALLE 202608.csv");
  });
});

describe("detalleCpeCompleto", () => {
  /** Un cliente falso que reparte `total` filas en páginas de `tamano`. */
  function clienteFalso(total: number, tamano: number) {
    const pedidos: Array<[number, number]> = [];
    return {
      cliente: {
        rpc: (_fn: string, _args: Record<string, unknown>) => ({
          range: async (desde: number, hasta: number) => {
            pedidos.push([desde, hasta]);
            const filas = [];
            for (let i = desde; i <= Math.min(hasta, total - 1); i++) filas.push({ linea: i });
            return { data: filas, error: null };
          },
        }),
      },
      pedidos,
    };
  }

  test("una sola página cuando el detalle no llega al tope", async () => {
    const { cliente, pedidos } = clienteFalso(120, 1000);
    const filas = await detalleCpeCompleto(cliente, null);
    assert.equal(filas.length, 120);
    assert.deepEqual(pedidos, [[0, 999]]);
  });

  test("pide una página más cuando el detalle cae justo en el tope: si no, se corta lo más reciente", async () => {
    const { cliente, pedidos } = clienteFalso(1000, 1000);
    const filas = await detalleCpeCompleto(cliente, null);
    assert.equal(filas.length, 1000);
    assert.deepEqual(pedidos, [[0, 999], [1000, 1999]]);
  });

  test("junta varias páginas cuando el detalle las supera", async () => {
    const { cliente, pedidos } = clienteFalso(2350, 1000);
    const filas = await detalleCpeCompleto(cliente, null);
    assert.equal(filas.length, 2350);
    assert.deepEqual(pedidos, [[0, 999], [1000, 1999], [2000, 2999]]);
  });

  test("propaga el error de una página en vez de devolver lo parcial", async () => {
    const cliente = {
      rpc: () => ({ range: async () => ({ data: null, error: { message: "sin permiso" } }) }),
    };
    await assert.rejects(() => detalleCpeCompleto(cliente, null), /sin permiso/);
  });
});
