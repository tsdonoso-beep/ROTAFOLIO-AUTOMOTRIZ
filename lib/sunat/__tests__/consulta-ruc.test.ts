import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { leerResultadoConsultaRuc } from "../consulta-ruc.ts";

// Las dos formas de maquetado que se vieron: etiqueta y valor en la misma
// celda, o cada uno en su propia fila (resaltada en verde en el portal real).
const RESULTADO_MISMA_CELDA = `
<table>
<tr><td><b>Número de RUC:</b></td><td>20601712521 - CONSORCIO INDUSTRIAS ROLAND PRINT S.A.C. - INRO PLASTICOS S.A.C.</td></tr>
<tr><td><b>Estado del Contribuyente:</b></td><td>ACTIVO</td></tr>
<tr><td><b>Condición del Contribuyente:</b></td><td>HABIDO</td></tr>
<tr><td><b>Padrones:</b></td><td>NINGUNO</td></tr>
<tr><td>Fecha consulta: 19/09/2026 11:54</td></tr>
</table>`;

const RESULTADO_FILA_SEPARADA = `
<table>
<tr><td>Número de RUC:</td><td>20547825781 - DMG DRILLING E.I.R.L.</td></tr>
<tr class="bgn"><td>Estado del Contribuyente:</td></tr>
<tr class="bgn"><td>ACTIVO</td></tr>
<tr class="bgn"><td>Condición del Contribuyente:</td></tr>
<tr class="bgn"><td>HABIDO</td></tr>
<tr><td>Padrones:</td></tr>
<tr><td>Incorporado al Régimen de Buenos Contribuyentes (Resolución N&deg; 0230050312818)</td></tr>
<tr><td>a partir del 01/02/2022</td></tr>
<tr><td>Fecha consulta: 19/09/2026 11:55</td></tr>
</table>`;

describe("leerResultadoConsultaRuc", () => {
  test("un RUC sin ningún padrón (mismo caso que INROPRIN)", () => {
    const r = leerResultadoConsultaRuc(RESULTADO_MISMA_CELDA, "20601712521");
    assert.equal(r.encontrado, true);
    assert.equal(r.razonSocial, "CONSORCIO INDUSTRIAS ROLAND PRINT S.A.C. - INRO PLASTICOS S.A.C.");
    assert.equal(r.estado, "ACTIVO");
    assert.equal(r.condicion, "HABIDO");
    assert.equal(r.buenContribuyente, false);
    assert.equal(r.agenteRetencion, false);
    assert.equal(r.agentePercepcion, false);
    assert.equal(r.padronesTexto, null);
  });

  test("un RUC Buen Contribuyente, con la etiqueta y el valor en filas separadas", () => {
    const r = leerResultadoConsultaRuc(RESULTADO_FILA_SEPARADA, "20547825781");
    assert.equal(r.encontrado, true);
    assert.equal(r.razonSocial, "DMG DRILLING E.I.R.L.");
    assert.equal(r.buenContribuyente, true);
    assert.equal(r.agenteRetencion, false);
    assert.match(r.padronesTexto ?? "", /Buenos Contribuyentes/);
    assert.match(r.padronesTexto ?? "", /N° 0230050312818/);
  });

  test("una página que no trae los datos esperados: no se inventa nada", () => {
    const r = leerResultadoConsultaRuc("<html><body>Error inesperado</body></html>", "99999999999");
    assert.equal(r.encontrado, false);
    assert.equal(r.estado, null);
  });

  test("Agente de Retención se detecta por palabra clave, no por texto exacto", () => {
    const html = `<tr><td>Número de RUC:</td><td>20100000001 - EMPRESA GRANDE S.A.</td></tr>
      <tr><td>Padrones:</td><td>Designado como Agente de Retención del IGV mediante Resolución N&deg; 001 a partir del 01/01/2020</td></tr>`;
    const r = leerResultadoConsultaRuc(html, "20100000001");
    assert.equal(r.agenteRetencion, true);
    assert.equal(r.buenContribuyente, false);
  });
});
