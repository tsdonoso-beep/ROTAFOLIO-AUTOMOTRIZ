import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  leerComprobanteXml, valor, valores, bloque, bloques, atributo,
  aMonto, partirSerieNumero,
} from "../cpe-xml.ts";

// Una factura UBL 2.1 recortada, con la forma real que baja SUNAT: prefijos
// cbc/cac, la firma con su propio cbc:ID, dos partes con RUC, y dos líneas.
const FACTURA = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent>
    <ds:Signature><ds:SignedInfo><ds:Reference><ds:DigestValue>abc</ds:DigestValue></ds:Reference></ds:SignedInfo>
    <cbc:ID>SignatureSP</cbc:ID>
    </ds:Signature>
  </ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>
  <cbc:ID>F001-00000123</cbc:ID>
  <cbc:IssueDate>2026-08-27</cbc:IssueDate>
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="6">20557777645</cbc:ID></cac:PartyIdentification>
      <cac:PartyLegalEntity><cbc:RegistrationName>INRO PLASTICOS S.A.C.</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="6">20512201611</cbc:ID></cac:PartyIdentification>
      <cac:PartyLegalEntity><cbc:RegistrationName>INDUSTRIAS ROLAND PRINT S.A.C.</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="PEN">128.10</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="PEN">712.65</cbc:LineExtensionAmount>
    <cbc:PayableAmount currencyID="PEN">840.75</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="NIU">4</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="PEN">1149.16</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>CONTENEDOR DE BASURA INDUSTRIAL 240L</cbc:Description></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="PEN">287.29</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID>
    <cbc:InvoicedQuantity unitCode="CEN">2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="PEN">14.40</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>BOLSA NEGRA ECONOMICA 20X30</cbc:Description></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="PEN">7.20</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`;

const NOTA_CREDITO = `<?xml version="1.0"?>
<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>FC01-00000009</cbc:ID>
  <cbc:IssueDate>2026-08-30</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID>20552991291</cbc:ID></cac:PartyIdentification>
    <cac:PartyLegalEntity><cbc:RegistrationName>ALEPHGRAPHICS PERU MACHINERY S.A.C.</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="PEN">3540.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:CreditNoteLine>
    <cbc:ID>1</cbc:ID>
    <cbc:CreditedQuantity unitCode="ZZ">1</cbc:CreditedQuantity>
    <cbc:LineExtensionAmount currencyID="PEN">3000.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>ANULACION SERVICIO TECNICO</cbc:Description></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="PEN">3000.00</cbc:PriceAmount></cac:Price>
  </cac:CreditNoteLine>
</CreditNote>`;

describe("primitivas de lectura", () => {
  test("valor ignora el prefijo del espacio de nombres", () => {
    assert.equal(valor("<cbc:IssueDate>2026-08-27</cbc:IssueDate>", "IssueDate"), "2026-08-27");
    assert.equal(valor("<IssueDate>2026-08-27</IssueDate>", "IssueDate"), "2026-08-27");
    assert.equal(valor("<n1:IssueDate>2026-08-27</n1:IssueDate>", "IssueDate"), "2026-08-27");
  });

  test("valor de una etiqueta ausente es null", () => {
    assert.equal(valor("<a>x</a>", "IssueDate"), null);
  });

  test("valores devuelve todos, en orden", () => {
    assert.deepEqual(valores("<cbc:ID>SignatureSP</cbc:ID><cbc:ID>F001-1</cbc:ID>", "ID"),
      ["SignatureSP", "F001-1"]);
  });

  test("valor desenvuelve el texto en CDATA", () => {
    // SUNAT envuelve razón social y descripción en CDATA.
    assert.equal(valor("<cbc:RegistrationName><![CDATA[ROLAND PRINT S.A.C - INROPRIN]]></cbc:RegistrationName>", "RegistrationName"),
      "ROLAND PRINT S.A.C - INROPRIN");
    assert.equal(valor("<cbc:Description><![CDATA[RESINA ABS <AG12A0> & CIA]]></cbc:Description>", "Description"),
      "RESINA ABS <AG12A0> & CIA");
  });

  test("una etiqueta vacía no arrastra hasta un cierre lejano", () => {
    // <cbc:ID/> no debe capturar el ID real que viene después.
    assert.deepEqual(valores("<cbc:ID/><cac:X><cbc:ID>E001-9</cbc:ID></cac:X>", "ID"), ["E001-9"]);
  });

  test("atributo lee el unitCode de la cantidad", () => {
    assert.equal(atributo('<cbc:InvoicedQuantity unitCode="NIU">4</cbc:InvoicedQuantity>', "InvoicedQuantity", "unitCode"), "NIU");
  });

  test("bloques respeta el anidamiento y separa cada línea", () => {
    const b = bloques(FACTURA, "InvoiceLine");
    assert.equal(b.length, 2);
    assert.match(b[0], /CONTENEDOR/);
    assert.match(b[1], /BOLSA NEGRA/);
  });

  test("bloque toma el primero y no lo parte en un cierre interno", () => {
    const sup = bloque(FACTURA, "AccountingSupplierParty");
    assert.match(sup, /20557777645/);
    // No debe arrastrar al adquiriente.
    assert.doesNotMatch(sup, /20512201611/);
  });
});

describe("conversión", () => {
  test("aMonto entiende el formato UBL", () => {
    assert.equal(aMonto("840.75"), 840.75);
    assert.equal(aMonto("1,234.56"), 1234.56);
    assert.equal(aMonto(null), null);
    assert.equal(aMonto(""), null);
  });

  test("partirSerieNumero separa y quita ceros de relleno", () => {
    assert.deepEqual(partirSerieNumero("F001-00000123"), { serie: "F001", numero: "123" });
    assert.deepEqual(partirSerieNumero("E001-2293"), { serie: "E001", numero: "2293" });
    assert.deepEqual(partirSerieNumero("no-es-id-x"), { serie: null, numero: null });
  });
});

describe("leerComprobanteXml — factura", () => {
  const c = leerComprobanteXml(FACTURA);

  test("cabecera", () => {
    assert.equal(c.tipoComprobante, "01");
    assert.equal(c.serie, "F001");
    assert.equal(c.numero, "123");
    assert.equal(c.fechaEmision, "2026-08-27");
    assert.equal(c.moneda, "PEN");
    assert.equal(c.total, 840.75);
    assert.equal(c.subtotal, 712.65);
    assert.equal(c.igv, 128.10);
  });

  test("el proveedor es el emisor, no el adquiriente", () => {
    assert.equal(c.proveedorRuc, "20557777645");
    assert.equal(c.proveedorNombre, "INRO PLASTICOS S.A.C.");
    assert.equal(c.adquirienteRuc, "20512201611");
  });

  test("el ID del documento no se confunde con el de la firma", () => {
    // La firma trae <cbc:ID>SignatureSP</cbc:ID> antes que el ID real.
    assert.equal(c.serie, "F001");
  });

  test("los ítems", () => {
    assert.equal(c.items.length, 2);
    assert.deepEqual(c.items[0], {
      linea: 1, descripcion: "CONTENEDOR DE BASURA INDUSTRIAL 240L",
      cantidad: 4, unidad: "NIU", precioUnitario: 287.29, importe: 1149.16,
    });
    assert.equal(c.items[1].descripcion, "BOLSA NEGRA ECONOMICA 20X30");
    assert.equal(c.items[1].unidad, "CEN");
  });
});

const FACTURA_DETRACCION_CREDITO = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>F001-456</cbc:ID>
  <cbc:IssueDate>2026-08-10</cbc:IssueDate>
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID>20111111111</cbc:ID></cac:PartyIdentification>
    <cac:PartyLegalEntity><cbc:RegistrationName>CONSTRUCTORA SAC</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyIdentification><cbc:ID>20512201611</cbc:ID></cac:PartyIdentification>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:OrderReference><cbc:ID>OC-2026-77</cbc:ID></cac:OrderReference>
  <cac:DespatchDocumentReference><cbc:ID>T001-999</cbc:ID></cac:DespatchDocumentReference>
  <cac:PaymentTerms>
    <cbc:ID>FormaPago</cbc:ID>
    <cbc:PaymentMeansID>Credito</cbc:PaymentMeansID>
    <cbc:Amount currencyID="PEN">1000.00</cbc:Amount>
  </cac:PaymentTerms>
  <cac:PaymentTerms>
    <cbc:ID>FormaPago002</cbc:ID>
    <cbc:PaymentMeansID>Cuota002</cbc:PaymentMeansID>
    <cbc:Amount currencyID="PEN">500.00</cbc:Amount>
    <cbc:PaymentDueDate>2026-10-10</cbc:PaymentDueDate>
  </cac:PaymentTerms>
  <cac:PaymentTerms>
    <cbc:ID>FormaPago001</cbc:ID>
    <cbc:PaymentMeansID>Cuota001</cbc:PaymentMeansID>
    <cbc:Amount currencyID="PEN">500.00</cbc:Amount>
    <cbc:PaymentDueDate>2026-09-10</cbc:PaymentDueDate>
  </cac:PaymentTerms>
  <cac:PaymentTerms>
    <cbc:ID>Detraccion</cbc:ID>
    <cbc:PaymentMeansID>Deposito en cuenta - Banco de la Nacion</cbc:PaymentMeansID>
    <cbc:PaymentPercent>12.00</cbc:PaymentPercent>
    <cbc:Amount currencyID="PEN">120.00</cbc:Amount>
  </cac:PaymentTerms>
  <cac:TaxTotal><cbc:TaxAmount currencyID="PEN">180.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="PEN">1000.00</cbc:LineExtensionAmount>
    <cbc:PayableAmount currencyID="PEN">1180.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="ZZ">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="PEN">1000.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>SERVICIO DE CONSTRUCCION</cbc:Description></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="PEN">1000.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`;

describe("leerComprobanteXml — detracción, crédito, guía y OC", () => {
  const c = leerComprobanteXml(FACTURA_DETRACCION_CREDITO);

  test("forma de pago y guía/orden de compra relacionadas", () => {
    assert.equal(c.formaPago, "Credito");
    assert.equal(c.guiaRemision, "T001-999");
    assert.equal(c.ordenCompra, "OC-2026-77");
  });

  test("las cuotas salen en orden aunque el XML las traiga al revés", () => {
    assert.equal(c.cuotas.length, 2);
    assert.deepEqual(c.cuotas[0], { numero: 1, monto: 500, fechaVencimiento: "2026-09-10" });
    assert.deepEqual(c.cuotas[1], { numero: 2, monto: 500, fechaVencimiento: "2026-10-10" });
  });

  test("la detracción, con cuenta, porcentaje y monto", () => {
    assert.deepEqual(c.detraccion, {
      cuentaBanco: "Deposito en cuenta - Banco de la Nacion",
      porcentaje: 12,
      monto: 120,
    });
  });
});

describe("leerComprobanteXml — sin ninguno de estos datos", () => {
  test("factura simple: forma de pago y detracción quedan null, cuotas vacío", () => {
    const c = leerComprobanteXml(FACTURA);
    assert.equal(c.formaPago, null);
    assert.equal(c.detraccion, null);
    assert.deepEqual(c.cuotas, []);
    assert.equal(c.guiaRemision, null);
    assert.equal(c.ordenCompra, null);
  });
});

describe("leerComprobanteXml — nota de crédito", () => {
  const c = leerComprobanteXml(NOTA_CREDITO);

  test("el tipo lo fija la raíz, no un código interno", () => {
    assert.equal(c.tipoComprobante, "07");
  });

  test("lee sus líneas con CreditedQuantity", () => {
    assert.equal(c.items.length, 1);
    assert.equal(c.items[0].descripcion, "ANULACION SERVICIO TECNICO");
    assert.equal(c.items[0].cantidad, 1);
    assert.equal(c.items[0].unidad, "ZZ");
  });
});
