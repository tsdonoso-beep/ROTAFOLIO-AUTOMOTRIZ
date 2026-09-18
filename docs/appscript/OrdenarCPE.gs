// Ordenar, una vez, lo que el scraper subió antes de tener carpetas
//
// El scraper (`scripts/descargar-cpe.mts`) ya archiva cada XML/PDF nuevo
// directo en Emitidas|Recibidas|Otros / AAAA-MM. Esto es para lo que quedó
// suelto de las corridas de antes de ese cambio: lee cada XML, decide de qué
// carpeta es (comparando el RUC de la empresa, igual que hace el scraper) y
// lo mueve. De paso, llama a `guardar_cpe` con el enlace de Drive de cada uno,
// para que la hoja de detalle también los muestre con su «Enlace».
//
// Es un script SUELTO, no atado a ninguna hoja: se crea uno nuevo en
// script.google.com y se corre a mano, una vez. No necesita quedarse
// instalado después.
//
// ── Antes de correrlo ──
// Extensiones → Configuración del proyecto → Propiedades del script. Poner:
//   CARPETA_RAIZ        el ID de la carpeta de Drive (SUNAT_DRIVE_FOLDER)
//   RUC_EMPRESA         20512201611
//   SUPABASE_URL        el mismo de los secretos de GitHub
//   SUPABASE_ANON_KEY   el mismo de los secretos de GitHub
//   ROBOT_CORREO        el correo de la cuenta ROBOT
//   ROBOT_CLAVE         su clave
// La cuenta de Google con la que se corre el script necesita poder editar esa
// carpeta de Drive —si ya la usas para revisar los comprobantes, ya puede—.
//
// ── Cómo usarlo ──
// 1. revisarOrdenSunat()      — no mueve ni guarda nada, solo dice qué
//    encontró y a qué carpeta iría cada cosa. Ver el resultado en
//    Ejecuciones (el reloj de la izquierda) → abrir la corrida → Registros.
// 2. Si se ve bien, ordenarComprobantesSunat() — ahí sí mueve los archivos y
//    guarda el enlace de cada uno en la base.
//
// Se puede correr más de una vez sin duplicar nada: un archivo ya movido no
// vuelve a aparecer en la carpeta raíz, y `guardar_cpe` actualiza el
// comprobante que ya existía en vez de repetirlo.

function revisarOrdenSunat() { procesar(true); }
function ordenarComprobantesSunat() { procesar(false); }

function revisarPdfsSueltos() { ordenarPdfsSueltos(true); }
function moverPdfsSueltos() { ordenarPdfsSueltos(false); }

/**
 * Para cuando el XML de un comprobante ya se movió —quedó en
 * Emitidas|Recibidas/AAAA-MM— pero su PDF se quedó atrás en la raíz, porque
 * en esa corrida el emparejamiento todavía no encontraba pareja.
 *
 * No hace falta volver a leer el XML para saber a qué carpeta va: ya está
 * ahí. Se arma un mapa de qué XML quedó en qué carpeta (por serie-número-RUC,
 * leyendo cada uno una sola vez) y el PDF se manda a la misma carpeta que su
 * XML, sacando esa misma clave de su propio nombre.
 */
function ordenarPdfsSueltos(soloRevisar) {
  var cfg = configuracion();
  var raiz = DriveApp.getFolderById(cfg.carpetaRaiz);
  var mapa = mapaXmlsYaOrdenados(raiz, cfg);

  var movidos = 0;
  var sinPareja = [];
  var it = raiz.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (!/\.pdf$/i.test(f.getName())) continue;

    var partes = partirNombrePdf(f.getName());
    var destino = partes ? mapa[partes.serie + "|" + partes.numero + "|" + partes.ruc] : null;
    if (!destino) { sinPareja.push(f.getName()); continue; }

    if (!soloRevisar) f.moveTo(destino);
    movidos++;
  }

  Logger.log((soloRevisar ? "Se moverían " : "Se movieron ") + movidos + " PDF.");
  if (sinPareja.length > 0) {
    Logger.log("Sin XML con el que emparejar (" + sinPareja.length + "):");
    for (var i = 0; i < sinPareja.length; i++) Logger.log("  · " + sinPareja[i]);
  }
}

/** clave "serie|número|RUC del proveedor" → la carpeta AAAA-MM donde ya quedó ese XML. */
function mapaXmlsYaOrdenados(raiz, cfg) {
  var mapa = {};
  var subcarpetas = raiz.getFolders();
  while (subcarpetas.hasNext()) {
    var sub = subcarpetas.next(); // Emitidas / Recibidas / Otros
    var meses = sub.getFolders();
    while (meses.hasNext()) {
      var mes = meses.next(); // AAAA-MM / Sin fecha
      var archivos = mes.getFiles();
      while (archivos.hasNext()) {
        var f = archivos.next();
        if (!/\.(xml|zip)$/i.test(f.getName())) continue;
        try {
          var texto = leerXmlDeArchivo(f);
          if (!texto) continue;
          var c = leerComprobante(texto, cfg.rucEmpresa);
          if (!c.serie || !c.numero) continue;
          mapa[c.serie + "|" + c.numero + "|" + c.proveedorRuc] = mes;
        } catch (e) { /* un XML raro no debe tumbar el resto */ }
      }
    }
  }
  return mapa;
}

/**
 * Diagnóstico puntual: imprime, para los primeros XML y PDF, los valores
 * exactos entre corchetes —para pescar un espacio o una diferencia de un
 * dígito que a simple vista no se ve— sin mover ni guardar nada.
 */
function diagnosticoEmparejado() {
  var cfg = configuracion();
  var raiz = DriveApp.getFolderById(cfg.carpetaRaiz);
  var listado = listarArchivos(raiz);
  Logger.log("XML/ZIP: " + listado.xmls.length + ". PDF: " + listado.pdfs.length);

  for (var i = 0; i < Math.min(5, listado.xmls.length); i++) {
    var xmlTexto = leerXmlDeArchivo(listado.xmls[i]);
    var c = leerComprobante(xmlTexto, cfg.rucEmpresa);
    Logger.log("XML " + listado.xmls[i].getName()
      + " -> serie=[" + c.serie + "] numero=[" + c.numero + "] proveedorRuc=[" + c.proveedorRuc + "]");
  }

  for (var j = 0; j < Math.min(5, listado.pdfs.length); j++) {
    var nombre = listado.pdfs[j].getName();
    var partes = partirNombrePdf(nombre);
    Logger.log("PDF " + nombre + " -> " + (partes
      ? ("serie=[" + partes.serie + "] numero=[" + partes.numero + "] ruc=[" + partes.ruc + "]")
      : "no calzó el patrón PDF-DOC-...pdf"));
  }
}

function procesar(soloRevisar) {
  var cfg = configuracion();
  if (!cfg.carpetaRaiz) throw new Error("Falta CARPETA_RAIZ en las Propiedades del script.");

  var raiz = DriveApp.getFolderById(cfg.carpetaRaiz);
  var listado = listarArchivos(raiz);
  var pdfsLibres = listado.pdfs.slice();

  var doclotes = [];
  var porCarpeta = {};
  var sinXml = 0, errores = 0;

  for (var i = 0; i < listado.xmls.length; i++) {
    var archivoXml = listado.xmls[i];
    try {
      var xmlTexto = leerXmlDeArchivo(archivoXml);
      if (!xmlTexto) { sinXml++; continue; }

      var c = leerComprobante(xmlTexto, cfg.rucEmpresa);
      if (!c.serie || !c.numero) { sinXml++; continue; }

      var origen = c.origen;
      var periodo = periodoDe(c.fechaEmision);
      var ruta = rutaDe(origen, periodo);
      var clave = ruta.join("/");
      porCarpeta[clave] = (porCarpeta[clave] || 0) + 1;

      // El PDF de SUNAT no siempre lleva el mismo nombre que el XML: se
      // busca por el mismo nombre primero y, si no, por si el nombre del PDF
      // contiene la serie-número del comprobante (con o sin el guion).
      var pdfPar = emparejarPdf(archivoXml, c, pdfsLibres);
      if (pdfPar) quitarDeLista(pdfsLibres, pdfPar);

      if (!soloRevisar) {
        var destino = carpetaAnidada(raiz, ruta);
        mover(archivoXml, destino, raiz);
        if (pdfPar) mover(pdfPar, destino, raiz);
        doclotes.push(aDocLote(c, archivoXml.getUrl(), pdfPar ? pdfPar.getUrl() : null));
      }
    } catch (e) {
      errores++;
      Logger.log("✗ " + archivoXml.getName() + ": " + e);
    }
  }

  Logger.log("— Resumen —");
  for (var k in porCarpeta) Logger.log(k + ": " + porCarpeta[k]);
  Logger.log("Sin XML legible: " + sinXml + ". Errores: " + errores + ".");

  if (pdfsLibres.length > 0) {
    Logger.log("PDF sin pareja encontrada (se quedaron donde estaban): " + pdfsLibres.length);
    for (var p = 0; p < pdfsLibres.length; p++) Logger.log("  · " + pdfsLibres[p].getName());
  }

  if (soloRevisar) {
    Logger.log("Solo revisión: no se movió ni se guardó nada. Corre ordenarComprobantesSunat() para aplicarlo.");
  } else if (doclotes.length > 0) {
    guardarEnBase(doclotes, cfg);
  } else {
    Logger.log("No había nada que mover.");
  }
}

/**
 * El PDF que corresponde a un XML.
 *
 * SUNAT nombra el PDF `PDF-DOC-<serie><número><RUC del proveedor>.pdf`, todo
 * pegado y sin guiones —el XML, en cambio, trae su propio nombre suelto—. La
 * serie son los primeros 4 caracteres, el RUC los últimos 11 dígitos (un RUC
 * peruano siempre tiene 11), y lo que queda en medio es el número, sin ceros
 * de relleno. Con eso se arma la clave exacta en vez de adivinar por
 * substring, que con números cortos (2-3 dígitos) daría falsos positivos.
 */
function emparejarPdf(archivoXml, c, pdfsLibres) {
  for (var i = 0; i < pdfsLibres.length; i++) {
    var partes = partirNombrePdf(pdfsLibres[i].getName());
    if (partes && partes.serie === c.serie && partes.numero === c.numero && partes.ruc === c.proveedorRuc) {
      return pdfsLibres[i];
    }
  }
  return null;
}

function partirNombrePdf(nombre) {
  var m = /^PDF-DOC-(.+)\.pdf$/i.exec(nombre);
  if (!m) return null;
  var cuerpo = m[1];
  if (cuerpo.length < 16) return null; // 4 de serie + al menos 1 de número + 11 de RUC
  return {
    serie: cuerpo.substring(0, 4).toUpperCase(),
    numero: cuerpo.substring(4, cuerpo.length - 11).replace(/^0+/, "") || "0",
    ruc: cuerpo.substring(cuerpo.length - 11),
  };
}

function quitarDeLista(lista, item) {
  var idx = lista.indexOf(item);
  if (idx >= 0) lista.splice(idx, 1);
}

// ── Configuración ──────────────────────────────────────────────────

function configuracion() {
  var p = PropertiesService.getScriptProperties();
  return {
    carpetaRaiz: p.getProperty("CARPETA_RAIZ"),
    rucEmpresa: p.getProperty("RUC_EMPRESA") || "20512201611",
    supabaseUrl: p.getProperty("SUPABASE_URL"),
    anonKey: p.getProperty("SUPABASE_ANON_KEY"),
    robotCorreo: p.getProperty("ROBOT_CORREO"),
    robotClave: p.getProperty("ROBOT_CLAVE"),
  };
}

// ── Qué hay suelto en la carpeta raíz ─────────────────────────────
//
// `getFiles()` solo trae los archivos QUE ESTÁN DIRECTO en la carpeta, no los
// de Emitidas/Recibidas/Otros: por eso no hace falta excluirlos a mano, ni
// hay riesgo de tocar dos veces lo que ya se ordenó.
//
// Los XML y los PDF se listan aparte —no por un nombre en común, que SUNAT no
// siempre respeta entre los dos enlaces de descarga— y se emparejan más
// adelante por serie-número, leyendo el XML.

function listarArchivos(raiz) {
  var xmls = [], pdfs = [];
  var it = raiz.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    var nombre = f.getName();
    if (/\.pdf$/i.test(nombre)) pdfs.push(f);
    else if (/\.(xml|zip)$/i.test(nombre)) xmls.push(f);
  }
  return { xmls: xmls, pdfs: pdfs };
}

/** El texto del XML de un archivo, sacándolo del ZIP si hace falta. */
function leerXmlDeArchivo(archivo) {
  var nombre = archivo.getName();
  if (/\.zip$/i.test(nombre)) {
    var partes = Utilities.unzip(archivo.getBlob());
    for (var i = 0; i < partes.length; i++) {
      if (/\.xml$/i.test(partes[i].getName())) return decodificarBlob(partes[i]);
    }
    return null;
  }
  if (/\.xml$/i.test(nombre)) return decodificarBlob(archivo.getBlob());
  return null;
}

/**
 * Decodifica el XML por lo que los bytes SON, no por lo que el propio XML
 * dice que son.
 *
 * Algunos emisores declaran `encoding="ISO-8859-1"` en el prólogo mintiendo:
 * el contenido real es UTF-8, y confiar en la etiqueta da textos como
 * «DONACIÃN» en vez de «DONACIÓN». UTF-8 es autoverificable, así que se
 * prueba estricto primero y solo se cae a Latin-1 cuando de verdad no lo es.
 */
function decodificarBlob(blob) {
  return esUtf8Valido(blob.getBytes())
    ? blob.getDataAsString("UTF-8")
    : blob.getDataAsString("ISO-8859-1");
}

/**
 * Si una secuencia de bytes es UTF-8 válido, byte a byte.
 *
 * `TextDecoder(..., { fatal: true })` —que es como se resuelve esto mismo en
 * Node (`lib/sunat/cpe-xml.ts`)— no lanza como se espera en el runtime de
 * Apps Script: siempre caía al `catch` y el resultado no cambiaba nunca,
 * aunque el archivo sí fuera UTF-8 real. Esto valida a mano, byte por byte,
 * sin depender de esa API.
 */
function esUtf8Valido(bytes) {
  var i = 0, n = bytes.length;
  while (i < n) {
    var b = bytes[i] & 0xff; // Apps Script los da con signo (-128..127)
    if (b <= 0x7f) { i++; continue; }

    var extra;
    if ((b & 0xe0) === 0xc0) extra = 1;       // 110xxxxx
    else if ((b & 0xf0) === 0xe0) extra = 2;  // 1110xxxx
    else if ((b & 0xf8) === 0xf0) extra = 3;  // 11110xxx
    else return false;                        // no es un byte de inicio válido

    if (i + extra >= n) return false;
    for (var j = 1; j <= extra; j++) {
      if (((bytes[i + j] & 0xff) & 0xc0) !== 0x80) return false; // 10xxxxxx
    }
    i += extra + 1;
  }
  return true;
}

// ── Mover ──────────────────────────────────────────────────────────

function rutaDe(origen, periodo) {
  var sub = origen === "RECIBIDO" ? "Recibidas" : origen === "EMITIDO" ? "Emitidas" : "Otros";
  var mes = (periodo && /^\d{6}$/.test(periodo)) ? (periodo.substring(0, 4) + "-" + periodo.substring(4, 6)) : "Sin fecha";
  return [sub, mes];
}

function carpetaAnidada(raiz, segmentos) {
  var actual = raiz;
  for (var i = 0; i < segmentos.length; i++) actual = subcarpeta(actual, segmentos[i]);
  return actual;
}

function subcarpeta(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

/**
 * `addFile`/`removeFile` —la API vieja de `DriveApp`— no funciona con ítems
 * de una unidad compartida: tira «Cannot use this operation on a shared
 * drive item». `moveTo` sí, y sirve igual para Mi unidad.
 */
function mover(archivo, destino, origen) {
  if (destino.getId() === origen.getId()) return;
  archivo.moveTo(destino);
}

// ── Leer el XML (UBL 2.1), con XmlService en vez de a mano ─────────
//
// `getName()` de un elemento devuelve el nombre SIN el prefijo del espacio de
// nombres: `<cbc:ID>` se ve como "ID" igual que `<n1:ID>`. Es lo mismo que el
// parser de Node (`lib/sunat/cpe-xml.ts`) hace con una expresión regular que
// ignora el prefijo; acá sale gratis con la API del propio Apps Script.

function leerComprobante(xmlTexto, rucEmpresa) {
  var raizXml = XmlService.parse(xmlTexto).getRootElement();
  var tipoInfo = tipoDe(raizXml);

  // El ID del documento es el primer «ID» con forma serie-número: no la del
  // RUC de una parte (esos son solo dígitos) ni la de la firma.
  var ids = buscarTodos(raizXml, "ID");
  var idDoc = null;
  for (var i = 0; i < ids.length; i++) {
    var t = textoDe(ids[i]);
    if (t && /^[A-Za-z0-9]{1,4}-\d+$/.test(t)) { idDoc = t; break; }
  }
  var partes = partirSerieNumero(idDoc);

  var proveedor = parteDe(buscarUno(raizXml, "AccountingSupplierParty"));
  var adquiriente = parteDe(buscarUno(raizXml, "AccountingCustomerParty"));
  var totales = buscarUno(raizXml, "LegalMonetaryTotal");
  var taxTotal = buscarUno(raizXml, "TaxTotal"); // el primero es el del documento

  var lineas = buscarTodos(raizXml, tipoInfo.lineaTag);
  var items = [];
  for (var j = 0; j < lineas.length; j++) items.push(itemDe(lineas[j], tipoInfo.cantidadTag));
  items.sort(function (a, b) { return (a.linea || 0) - (b.linea || 0); });

  var ruc = (rucEmpresa || "").trim();
  var origen = adquiriente.ruc === ruc ? "RECIBIDO" : proveedor.ruc === ruc ? "EMITIDO" : "OTRO";
  var pago = pagoDe(raizXml);
  var relacionado = buscarUno(raizXml, "AdditionalDocumentReference");

  return {
    origen: origen,
    tipoComprobante: tipoInfo.tipo,
    serie: partes.serie, numero: partes.numero,
    fechaEmision: aFecha(valorDe(raizXml, "IssueDate")),
    moneda: valorDe(raizXml, "DocumentCurrencyCode"),
    proveedorRuc: proveedor.ruc, proveedorNombre: proveedor.nombre,
    adquirienteRuc: adquiriente.ruc, adquirienteNombre: adquiriente.nombre,
    subtotal: aMonto(valorDe(totales, "LineExtensionAmount")),
    igv: aMonto(valorDe(taxTotal, "TaxAmount")),
    total: aMonto(valorDe(totales, "PayableAmount")),
    formaPago: pago.formaPago,
    cuotas: pago.cuotas,
    detraccion: pago.detraccion,
    guiaRemision: valorDe(buscarUno(raizXml, "DespatchDocumentReference"), "ID"),
    ordenCompra: valorDe(buscarUno(raizXml, "OrderReference"), "ID"),
    anticipoAplicado: aMonto(valorDe(totales, "PrepaidAmount")),
    documentoRelacionado: valorDe(relacionado, "ID"),
    tipoDocumentoRelacionado: valorDe(relacionado, "DocumentType"),
    items: items,
  };
}

/**
 * La forma de pago, sus cuotas si es al crédito, y la detracción.
 *
 * Los tres viven en bloques `cac:PaymentTerms` —uno por cada cosa—. La
 * cabecera de forma de pago y CADA UNA DE SUS CUOTAS comparten el MISMO
 * `cbc:ID` «FormaPago» —un XML real lo confirmó—, así que una cuota se
 * reconoce PRIMERO por que su `PaymentMeansID` empieza con «Cuota»:
 * revisarlo después de "¿es FormaPago?" hace que la última cuota le pise el
 * valor a la forma de pago, y las cuotas nunca se guarden. Mismo criterio
 * que `lib/sunat/cpe-xml.ts`.
 *
 * La cuenta de la detracción NO vive acá: `PaymentTerms[Detraccion]/PaymentMeansID`
 * es el código del bien/servicio detraído (catálogo 54), no una cuenta. La
 * cuenta real está en `cac:PaymentMeans`, un bloque aparte.
 */
function pagoDe(raizXml) {
  var formaPago = null;
  var detraccion = null;
  var cuotas = [];

  var bloquesPago = buscarTodos(raizXml, "PaymentTerms");
  for (var i = 0; i < bloquesPago.length; i++) {
    var b = bloquesPago[i];
    var id = valorDe(b, "ID");
    var medio = valorDe(b, "PaymentMeansID");

    if (id === "Detraccion") {
      detraccion = {
        cuentaBanco: cuentaDetraccionDe(raizXml),
        codigoBienServicio: medio,
        porcentaje: aMonto(valorDe(b, "PaymentPercent")),
        monto: aMonto(valorDe(b, "Amount")),
      };
    } else if (medio && /^cuota/i.test(medio)) {
      var m = /\d+/.exec(medio);
      cuotas.push({
        numero: m ? Number(m[0]) : null,
        monto: aMonto(valorDe(b, "Amount")),
        fechaVencimiento: aFecha(valorDe(b, "PaymentDueDate")),
      });
    } else if (id === "FormaPago") {
      formaPago = medio;
    }
  }

  cuotas.sort(function (a, b2) { return (a.numero || 0) - (b2.numero || 0); });
  return { formaPago: formaPago, cuotas: cuotas, detraccion: detraccion };
}

/**
 * La cuenta del Banco de la Nación de la detracción, de `cac:PaymentMeans`
 * —no de `PaymentTerms`, que solo trae el código del bien/servicio—.
 */
function cuentaDetraccionDe(raizXml) {
  var bloquesMedio = buscarTodos(raizXml, "PaymentMeans");
  for (var i = 0; i < bloquesMedio.length; i++) {
    if (valorDe(bloquesMedio[i], "ID") === "Detraccion") {
      return valorDe(buscarUno(bloquesMedio[i], "PayeeFinancialAccount"), "ID");
    }
  }
  return null;
}

function tipoDe(raizXml) {
  var nombre = raizXml.getName();
  if (nombre === "CreditNote") return { tipo: "07", lineaTag: "CreditNoteLine", cantidadTag: "CreditedQuantity" };
  if (nombre === "DebitNote") return { tipo: "08", lineaTag: "DebitNoteLine", cantidadTag: "DebitedQuantity" };
  return { tipo: valorDe(raizXml, "InvoiceTypeCode"), lineaTag: "InvoiceLine", cantidadTag: "InvoicedQuantity" };
}

function parteDe(bloqueParte) {
  if (!bloqueParte) return { ruc: null, nombre: null };
  var ruc = valorDe(buscarUno(bloqueParte, "PartyIdentification"), "ID");
  var nombre = valorDe(buscarUno(bloqueParte, "PartyLegalEntity"), "RegistrationName")
    || valorDe(buscarUno(bloqueParte, "PartyName"), "Name");
  return { ruc: ruc, nombre: nombre };
}

function itemDe(bloqueLinea, cantidadTag) {
  var linea = valorDe(bloqueLinea, "ID");
  return {
    linea: linea ? (Number(linea) || null) : null,
    descripcion: valorDe(buscarUno(bloqueLinea, "Item"), "Description"),
    cantidad: aMonto(valorDe(bloqueLinea, cantidadTag)),
    unidad: atributoDe(bloqueLinea, cantidadTag, "unitCode"),
    precioUnitario: aMonto(valorDe(buscarUno(bloqueLinea, "Price"), "PriceAmount")),
    importe: aMonto(valorDe(bloqueLinea, "LineExtensionAmount")),
  };
}

/** Todos los descendientes con ese nombre local, en el orden del documento. */
function buscarTodos(elemento, nombre) {
  var out = [];
  var hijos = elemento.getChildren();
  for (var i = 0; i < hijos.length; i++) {
    var h = hijos[i];
    if (h.getName() === nombre) out.push(h);
    out = out.concat(buscarTodos(h, nombre));
  }
  return out;
}

function buscarUno(elemento, nombre) {
  if (!elemento) return null;
  var t = buscarTodos(elemento, nombre);
  return t.length ? t[0] : null;
}

function textoDe(elemento) {
  var t = elemento.getText();
  return t ? t.trim() : null;
}

function valorDe(contenedor, nombre) {
  var e = buscarUno(contenedor, nombre);
  return e ? textoDe(e) : null;
}

function atributoDe(contenedor, nombre, attr) {
  var e = buscarUno(contenedor, nombre);
  if (!e) return null;
  var a = e.getAttribute(attr);
  return a ? a.getValue() : null;
}

function partirSerieNumero(id) {
  if (!id) return { serie: null, numero: null };
  var m = /^([A-Za-z0-9]{1,4})-(\d+)$/.exec(id.trim());
  if (!m) return { serie: null, numero: null };
  return { serie: m[1].toUpperCase(), numero: m[2].replace(/^0+/, "") || "0" };
}

function aMonto(v) {
  if (v == null) return null;
  var s = v.replace(/\s/g, "");
  if (!s) return null;
  var limpio = (s.indexOf(",") >= 0 && s.indexOf(".") >= 0) ? s.replace(/,/g, "")
    : s.indexOf(",") >= 0 ? s.replace(",", ".") : s;
  var n = Number(limpio);
  return isFinite(n) ? n : null;
}

function aFecha(v) {
  if (!v) return null;
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  return m ? (m[1] + "-" + m[2] + "-" + m[3]) : null;
}

function periodoDe(fechaEmision) {
  if (!fechaEmision) return null;
  var m = /^(\d{4})-(\d{2})/.exec(fechaEmision);
  return m ? (m[1] + m[2]) : null;
}

// ── Guardar en la base, con el enlace de Drive ─────────────────────
//
// Se llama a `guardar_cpe`, la misma función RPC que usa el scraper: como el
// comprobante ya existe (se importó cuando se bajó), esto lo actualiza y de
// paso le pone el `xml_drive_url` que antes no tenía. No hace falta una
// función nueva en la base para esto.

function aDocLote(c, xmlUrl, pdfUrl) {
  return {
    origen: c.origen,
    proveedorRuc: c.proveedorRuc, proveedorNombre: c.proveedorNombre,
    adquirienteRuc: c.adquirienteRuc, adquirienteNombre: c.adquirienteNombre,
    tipoComprobante: c.tipoComprobante, serie: c.serie, numero: c.numero,
    fechaEmision: c.fechaEmision, moneda: c.moneda,
    subtotal: c.subtotal, igv: c.igv, total: c.total,
    periodo: periodoDe(c.fechaEmision),
    xmlDriveUrl: xmlUrl,
    pdfDriveUrl: pdfUrl || null,
    formaPago: c.formaPago,
    cuotas: c.cuotas,
    detraccionCuentaBanco: c.detraccion ? c.detraccion.cuentaBanco : null,
    detraccionCodigoBienServicio: c.detraccion ? c.detraccion.codigoBienServicio : null,
    detraccionPorcentaje: c.detraccion ? c.detraccion.porcentaje : null,
    detraccionMonto: c.detraccion ? c.detraccion.monto : null,
    guiaRemision: c.guiaRemision,
    ordenCompra: c.ordenCompra,
    anticipoAplicado: c.anticipoAplicado,
    documentoRelacionado: c.documentoRelacionado,
    tipoDocumentoRelacionado: c.tipoDocumentoRelacionado,
    items: c.items,
  };
}

function actualizarEnlacesPdf() {
  var cfg = configuracion();
  var raiz = DriveApp.getFolderById(cfg.carpetaRaiz);
  var doclotes = [];

  var subcarpetas = raiz.getFolders();
  while (subcarpetas.hasNext()) {
    var sub = subcarpetas.next(); // Emitidas / Recibidas / Otros
    var meses = sub.getFolders();
    while (meses.hasNext()) {
      var mes = meses.next(); // AAAA-MM / Sin fecha
      var todos = [];
      var it = mes.getFiles();
      while (it.hasNext()) todos.push(it.next());

      var pdfsPorClave = {};
      for (var i = 0; i < todos.length; i++) {
        if (!/\.pdf$/i.test(todos[i].getName())) continue;
        var partes = partirNombrePdf(todos[i].getName());
        if (partes) pdfsPorClave[partes.serie + "|" + partes.numero + "|" + partes.ruc] = todos[i];
      }

      for (var j = 0; j < todos.length; j++) {
        var f = todos[j];
        if (!/\.(xml|zip)$/i.test(f.getName())) continue;
        try {
          var texto = leerXmlDeArchivo(f);
          if (!texto) continue;
          var c = leerComprobante(texto, cfg.rucEmpresa);
          if (!c.serie || !c.numero) continue;
          var pdf = pdfsPorClave[c.serie + "|" + c.numero + "|" + c.proveedorRuc];
          doclotes.push(aDocLote(c, f.getUrl(), pdf ? pdf.getUrl() : null));
        } catch (e) { /* un XML raro no debe tumbar el resto */ }
      }
    }
  }

  Logger.log("Comprobantes a re-guardar con su enlace de PDF: " + doclotes.length);
  if (doclotes.length > 0) guardarEnBase(doclotes, cfg);
}

function iniciarSesionRobot(cfg) {
  var resp = UrlFetchApp.fetch(cfg.supabaseUrl + "/auth/v1/token?grant_type=password", {
    method: "post",
    contentType: "application/json",
    headers: { apikey: cfg.anonKey },
    payload: JSON.stringify({ email: cfg.robotCorreo, password: cfg.robotClave }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error("No se pudo iniciar sesión con la cuenta ROBOT: " + resp.getContentText());
  }
  return JSON.parse(resp.getContentText()).access_token;
}

function guardarEnBase(doclotes, cfg) {
  if (!cfg.supabaseUrl || !cfg.anonKey || !cfg.robotCorreo || !cfg.robotClave) {
    Logger.log("Faltan credenciales de la base en las Propiedades del script: no se guardó nada, pero los archivos ya se movieron.");
    return;
  }

  var token = iniciarSesionRobot(cfg);
  var LOTE = 25;
  var nuevos = 0, actualizados = 0, items = 0;

  for (var i = 0; i < doclotes.length; i += LOTE) {
    var trozo = doclotes.slice(i, i + LOTE);
    var resp = UrlFetchApp.fetch(cfg.supabaseUrl + "/rest/v1/rpc/guardar_cpe", {
      method: "post",
      contentType: "application/json",
      headers: { apikey: cfg.anonKey, Authorization: "Bearer " + token },
      payload: JSON.stringify({ p_empresa_ruc: cfg.rucEmpresa, p_docs: trozo }),
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() >= 300) {
      Logger.log("✗ guardar_cpe falló en el lote " + i + ": " + resp.getContentText());
      continue;
    }
    var r = JSON.parse(resp.getContentText())[0];
    nuevos += r.nuevos; actualizados += r.actualizados; items += r.items;
  }

  Logger.log("Base: " + nuevos + " nuevos, " + actualizados + " actualizados, " + items + " ítems.");
}
