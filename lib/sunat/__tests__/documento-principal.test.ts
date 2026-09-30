import { test } from "node:test";
import assert from "node:assert/strict";
import { documentoPrincipal } from "../cpe-xml.ts";

const CDR = `<?xml version="1.0" encoding="UTF-8"?><ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2"><cbc:ID>1</cbc:ID></ApplicationResponse>`;
const FACTURA = `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><cbc:ID>F02V-75171</cbc:ID></Invoice>`;
const NOTA = `<?xml version="1.0"?><CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"></CreditNote>`;

test("con constancia primero (zip de COESTI vía OSE), elige la factura", () => {
  assert.equal(documentoPrincipal([CDR, FACTURA]), FACTURA);
});
test("nota de crédito y raíz con prefijo", () => {
  assert.equal(documentoPrincipal([CDR, NOTA]), NOTA);
  const conPrefijo = `<?xml version="1.0"?><inv:Invoice xmlns:inv="x"></inv:Invoice>`;
  assert.equal(documentoPrincipal([CDR, conPrefijo]), conPrefijo);
});
test("un solo XML (lo normal) se devuelve tal cual", () => {
  assert.equal(documentoPrincipal([FACTURA]), FACTURA);
});
test("solo constancia, o nada → null", () => {
  assert.equal(documentoPrincipal([CDR]), null);
  assert.equal(documentoPrincipal([]), null);
});
