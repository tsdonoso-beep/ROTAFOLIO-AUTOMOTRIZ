import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { periodoCerradoAnterior, periodoDe, validarPeriodo } from "../periodo.ts";
import { credencialesDe, usuarioSol } from "../credenciales.ts";
import { cuerpoDeToken, olvidarToken, obtenerToken, urlDeToken, vigencia, vigente } from "../token.ts";
import {
  leerTicket, mensajeDeEstado, resumirFallo, urlArchivo, urlEstadoTicket, urlExportarPropuesta,
} from "../sire.ts";
import { TICKET_PROPUESTA_RCE } from "./fixtures/ticket-real.ts";

const HOY = new Date("2026-09-11T00:00:00Z");
const CRED = {
  clientId: "11111111-2222-3333-4444-555555555555", clientSecret: "secreto",
  usuario: "USUARIOAPI", clave: "clave", ruc: "20512201611",
};

describe("período tributario", () => {
  test("acepta un período cerrado", () => {
    const r = validarPeriodo("202607", HOY);
    assert.equal(r.ok, true);
    if (r.ok) { assert.equal(r.anio, 2026); assert.equal(r.mes, 7); }
  });

  test("rechaza lo que no es yyyymm, que es el error 1006 de SUNAT", () => {
    for (const malo of ["2026-07", "julio", "20267", "202600", "202613", ""]) {
      assert.equal(validarPeriodo(malo, HOY).ok, false, malo);
    }
  });

  test("rechaza el futuro antes de gastar una llamada", () => {
    // SUNAT lo rechaza con el error 1007, pero recién después de que el
    // token se pidió y el proceso se encoló.
    const r = validarPeriodo("202612", HOY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.motivo, /todavía no existe/);
  });

  test("el mes en curso sí es válido, aunque esté a medias", () => {
    assert.equal(validarPeriodo("202609", HOY).ok, true);
  });

  test("rechaza antes de que el SIRE existiera", () => {
    const r = validarPeriodo("202112", HOY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.motivo, /2022/);
  });

  test("el período anterior cruza bien el año", () => {
    assert.equal(periodoCerradoAnterior(HOY), "202608");
    assert.equal(periodoCerradoAnterior(new Date("2026-01-15T00:00:00Z")), "202512");
  });

  test("periodoDe usa UTC y no la zona de quien corre esto", () => {
    assert.equal(periodoDe(new Date("2026-03-01T00:30:00Z")), "202603");
  });
});

describe("credenciales por empresa", () => {
  const entorno = {
    SUNAT_INROPRIN_CLIENT_ID: "id", SUNAT_INROPRIN_CLIENT_SECRET: "sec",
    SUNAT_INROPRIN_USUARIO: "USUARIOAPI", SUNAT_INROPRIN_CLAVE: "clave",
  };

  test("las arma desde el entorno", () => {
    const r = credencialesDe("INROPRIN", "20512201611", entorno);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.cred.clientId, "id");
  });

  test("dice exactamente qué variable falta", () => {
    const incompleto = { ...entorno, SUNAT_INROPRIN_CLAVE: undefined };
    const r = credencialesDe("INROPRIN", "20512201611", incompleto);
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.faltan, ["SUNAT_INROPRIN_CLAVE"]);
  });

  test("una abreviatura con guiones no rompe el nombre de la variable", () => {
    const r = credencialesDe("INROPRIN-GECOR", "20512201611", {
      SUNAT_INROPRIN_GECOR_CLIENT_ID: "a", SUNAT_INROPRIN_GECOR_CLIENT_SECRET: "b",
      SUNAT_INROPRIN_GECOR_USUARIO: "c", SUNAT_INROPRIN_GECOR_CLAVE: "d",
    });
    assert.equal(r.ok, true);
  });

  test("una variable con solo espacios cuenta como ausente", () => {
    const r = credencialesDe("INROPRIN", "20512201611", { ...entorno, SUNAT_INROPRIN_USUARIO: "   " });
    assert.equal(r.ok, false);
  });
});

describe("usuarioSol", () => {
  test("pega el RUC al usuario, que es como SUNAT lo espera", () => {
    assert.equal(usuarioSol("20512201611", "USUARIOAPI"), "20512201611USUARIOAPI");
  });

  test("no duplica el RUC si ya venía pegado", () => {
    // Es fácil que alguien ponga el valor completo en la variable de
    // entorno. Duplicarlo falla como "credenciales inválidas" y manda a
    // buscar el problema donde no está.
    assert.equal(usuarioSol("20512201611", "20512201611USUARIOAPI"), "20512201611USUARIOAPI");
  });

  test("ignora los espacios de sobra", () => {
    assert.equal(usuarioSol(" 20512201611 ", " USUARIOAPI "), "20512201611USUARIOAPI");
  });
});

describe("pedido de token", () => {
  test("manda grant_type=password, no client_credentials", () => {
    // SUNAT no usa el flujo habitual: además del par de credenciales pide
    // el usuario de Clave SOL y su contraseña.
    const c = cuerpoDeToken(CRED);
    assert.equal(c.get("grant_type"), "password");
    assert.equal(c.get("username"), "20512201611USUARIOAPI");
    assert.equal(c.get("password"), "clave");
  });

  test("el scope apunta al host que se va a consumir", () => {
    // Un token de SIRE no sirve para consultar comprobantes. Si el scope no
    // coincide con el host, la llamada falla con un 401 sin explicación.
    assert.equal(cuerpoDeToken(CRED).get("scope"), "https://api-sire.sunat.gob.pe");
  });

  test("el client_id va en la ruta, escapado", () => {
    assert.equal(
      urlDeToken("11111111-2222-3333-4444-555555555555"),
      "https://api-seguridad.sunat.gob.pe/v1/clientessol/11111111-2222-3333-4444-555555555555/oauth2/token/"
    );
  });
});

describe("vigencia del token", () => {
  test("se guarda un margen antes del vencimiento real", () => {
    // Sin margen, una petición que sale en el último segundo llega con el
    // token ya muerto.
    assert.equal(vigencia(3600, 1_000_000, 60), 1_000_000 + 3540_000);
  });

  test("un token de vida cortísima vence de inmediato en vez de quedar en el pasado", () => {
    assert.equal(vigencia(30, 1_000_000, 60), 1_000_000);
  });

  test("vigente() distingue el que sirve del que no", () => {
    assert.equal(vigente({ valor: "x", venceEn: 2000 }, 1000), true);
    assert.equal(vigente({ valor: "x", venceEn: 500 }, 1000), false);
    assert.equal(vigente(null, 1000), false);
  });
});

describe("obtenerToken", () => {
  test("reutiliza el token mientras sigue vigente", async () => {
    olvidarToken();
    let llamadas = 0;
    const falso = async () => {
      llamadas++;
      return new Response(JSON.stringify({ access_token: "T1", expires_in: 3600 }), { status: 200 });
    };
    await obtenerToken(CRED, { fetch: falso as unknown as typeof fetch });
    await obtenerToken(CRED, { fetch: falso as unknown as typeof fetch });
    assert.equal(llamadas, 1);
  });

  test("cuando SUNAT rechaza, el mensaje dice dónde mirar", async () => {
    olvidarToken();
    const falso = async () => new Response("invalid_client", { status: 401 });
    await assert.rejects(
      () => obtenerToken(CRED, { fetch: falso as unknown as typeof fetch }),
      /20512201611USUARIOAPI/
    );
  });
});

describe("rutas del SIRE", () => {
  test("exportar la propuesta lleva el período en la ruta", () => {
    const u = urlExportarPropuesta("202607", "csv");
    assert.match(u, /\/rce\/propuesta\/web\/propuesta\/202607\/exportacioncomprobantepropuesta/);
    assert.match(u, /codTipoArchivo=1/);
  });

  // Sin esto SUNAT responde 422 con el código 1061, que dice que el campo
  // está vacío pero no cuál es el valor que espera.
  test("exportar declara el origen del envío, que es obligatorio", () => {
    assert.match(urlExportarPropuesta("202607", "csv"), /codOrigenEnvio=2/);
  });

  test("txt y csv tienen códigos distintos", () => {
    assert.match(urlExportarPropuesta("202607", "txt"), /codTipoArchivo=0/);
  });

  test("el estado del ticket se consulta con el período en los dos extremos", () => {
    const u = urlEstadoTicket("202607", "20260000123");
    assert.match(u, /perIni=202607&perFin=202607/);
    assert.match(u, /numTicket=20260000123/);
  });

  test("el estado del ticket lleva el libro y el origen que exige el manual", () => {
    const u = urlEstadoTicket("202607", "20260000123");
    assert.match(u, /codLibro=080000/);
    assert.match(u, /codOrigenEnvio=2/);
  });

  test("el nombre del archivo se escapa", () => {
    const u = urlArchivo({
      nombre: "RCE 2026/07.zip", tipo: "1", periodo: "202607",
      codProceso: "1", numTicket: "20260000123",
    });
    assert.match(u, /nomArchivoReporte=RCE\+2026%2F07\.zip/);
  });

  // Los seis que exige el manual. El 422 solo nombró uno: los otros habrían
  // aparecido de a uno, una vuelta cada uno.
  test("bajar el archivo lleva los seis parámetros obligatorios", () => {
    const u = urlArchivo({
      nombre: "a.zip", tipo: "1", periodo: "202607",
      codProceso: "1", numTicket: "20260000123",
    });
    for (const p of [
      "nomArchivoReporte=a.zip", "codTipoArchivoReporte=1", "codLibro=080000",
      "perTributario=202607", "codProceso=1", "numTicket=20260000123",
    ]) assert.ok(u.includes(p), `falta ${p} en ${u}`);
  });
});

describe("leerTicket", () => {
  const conArchivo = {
    registros: [{
      numTicket: "20260000123", codEstadoProceso: "06", desEstadoProceso: "Terminado",
      perTributario: "202607", codProceso: "1",
      detalleTicket: [{ nomArchivoReporte: "LE20512201611.zip", codTipoArchivoReporte: "1" }],
    }],
  };

  test("un ticket terminado trae todo lo que hace falta para bajarlo", () => {
    const t = leerTicket(conArchivo)!;
    assert.equal(t.terminado, true);
    assert.equal(t.fallado, false);
    assert.deepEqual(t.archivo, {
      nombre: "LE20512201611.zip", tipo: "1",
      periodo: "202607", codProceso: "1", numTicket: "20260000123",
    });
  });

  test("también lee el nombre cuando viene en archivoReporte", () => {
    const t = leerTicket({
      registros: [{
        numTicket: "20260000124", desEstadoProceso: "Terminado", perTributario: "202607",
        codProceso: "1",
        archivoReporte: [{ nomArchivoReporte: "otro.zip", codTipoArchivoReporte: "1" }],
      }],
    })!;
    assert.equal(t.archivo?.nombre, "otro.zip");
  });

  test("sin archivo todavía no está terminado", () => {
    const t = leerTicket({ registros: [{ numTicket: "1", desEstadoProceso: "En proceso" }] })!;
    assert.equal(t.terminado, false);
    assert.equal(t.archivo, null);
  });

  test("reconoce el rechazo por el texto del estado", () => {
    const t = leerTicket({ registros: [{ numTicket: "1", desEstadoProceso: "Proceso con Error" }] })!;
    assert.equal(t.fallado, true);
  });

  test("si el tipo de archivo viene nulo, no rompe", () => {
    // El manual avisa de este caso: hay que repetir el tipo que se pidió.
    const t = leerTicket({ registros: [{ numTicket: "1", desEstadoProceso: "Terminado",
      detalleTicket: [{ nomArchivoReporte: "a.zip", codTipoArchivoReporte: null }] }] })!;
    assert.equal(t.archivo?.tipo, "");
  });

  test("una respuesta vacía no revienta", () => {
    assert.equal(leerTicket({ registros: [] }), null);
    assert.equal(leerTicket(null), null);
    assert.equal(leerTicket({}), null);
  });
});

describe("resumirFallo", () => {
  test("de un JSON deja el cuerpo, que trae el código del campo", () => {
    const j = `{"cod":422,"errors":[{"cod":1061,"msg":"El campo codOrigenEnvio es nulo o vacio."}]}`;
    assert.match(resumirFallo(j), /1061/);
  });

  // La página de error de SUNAT trae el agente de monitoreo incrustado y
  // ocupa miles de caracteres. Volcarla entera tapa el dato útil.
  test("de la página de error de SUNAT deja solo el título", () => {
    const html = '<html> <head> <title>Error 500 Request failed.</title> '
      + '<script type="text/javascript" src="/ruxitagentjs_ICA7NVfqrux_103432607.js" '
      + 'data-dtconfig="rid=RID_-800991767|rpid=-1277069840|domain=sunat.gob.pe"></script>'
      + '</head><body>' + "x".repeat(4000) + '</body></html>';
    const r = resumirFallo(html);
    assert.match(r, /Error 500 Request failed\./);
    assert.match(r, /página de error/);
    assert.ok(r.length < 200, `quedó largo: ${r.length}`);
    assert.ok(!r.includes("ruxitagentjs"));
  });

  test("un cuerpo vacío se dice, no se calla", () => {
    assert.equal(resumirFallo(""), "(sin cuerpo)");
    assert.equal(resumirFallo("   "), "(sin cuerpo)");
  });

  test("un texto suelto se recorta", () => {
    assert.equal(resumirFallo("algo salió mal"), "algo salió mal");
  });
});

// Lo que de verdad devolvió SUNAT. Los ejemplos inventados daban todos en
// verde mientras la descarga fallaba en producción.
describe("leerTicket con la respuesta real del SIRE", () => {
  const t = leerTicket({ registros: [TICKET_PROPUESTA_RCE] })!;

  test("reconoce que terminó", () => {
    assert.equal(t.terminado, true);
    assert.equal(t.fallado, false);
    assert.equal(t.descripcion, "Terminado");
  });

  test("saca el nombre de archivoReporte, porque el detalle lo trae en null", () => {
    assert.equal(t.archivo?.nombre, "20512201611-20260912-212509-propuesta.zip");
  });

  // El fallo que costó dos vueltas: SUNAT escribe el campo sin la erre de
  // «Archivo», así que buscando la grafía correcta salía vacío.
  test("lee el tipo aunque SUNAT lo escriba «codTipoAchivoReporte»", () => {
    assert.equal(t.archivo?.tipo, "00");
  });

  test("el tipo nunca debe viajar vacío: con vacío SUNAT responde 500", () => {
    assert.notEqual(t.archivo?.tipo, "");
  });

  test("trae período, proceso y ticket, que la descarga también exige", () => {
    assert.equal(t.archivo?.periodo, "202608");
    assert.equal(t.archivo?.codProceso, "10");
    assert.equal(t.archivo?.numTicket, "20260300000112");
  });

  test("la URL de descarga queda completa, sin ningún campo en blanco", () => {
    const u = new URL(urlArchivo(t.archivo!));
    for (const [k, v] of u.searchParams) {
      assert.notEqual(v, "", `${k} viajaría vacío`);
    }
    assert.equal(u.searchParams.get("codTipoArchivoReporte"), "00");
    assert.equal(u.searchParams.get("codProceso"), "10");
  });

  test("detalleTicket puede venir como objeto o como arreglo", () => {
    const comoArreglo = leerTicket({
      registros: [{ ...TICKET_PROPUESTA_RCE, detalleTicket: [TICKET_PROPUESTA_RCE.detalleTicket] }],
    })!;
    assert.equal(comoArreglo.archivo?.nombre, t.archivo?.nombre);
    assert.equal(comoArreglo.archivo?.tipo, "00");
  });
});

// El 429 salió pidiendo seis períodos seguidos. Sin traducirlo, el mensaje
// quedaba en «SUNAT devolvió una página de error», que no dice qué hacer.
describe("mensajeDeEstado", () => {
  test("el 429 dice que espere y que lo traído está a salvo", () => {
    const m = mensajeDeEstado(429)!;
    assert.match(m, /demasiado seguido/);
    assert.match(m, /Espera unos minutos/);
    assert.match(m, /ya se trajo está guardado/);
  });

  test("si SUNAT dice cuánto esperar, se repite en minutos", () => {
    assert.match(mensajeDeEstado(429, 600)!, /10 minutos/);
    // Medio minuto sigue siendo «1 minuto», no «0».
    assert.match(mensajeDeEstado(429, 30)!, /1 minutos?/);
  });

  test("credenciales rechazadas se distinguen de un límite", () => {
    assert.match(mensajeDeEstado(401)!, /credenciales/);
    assert.match(mensajeDeEstado(403)!, /credenciales/);
  });

  test("un fallo del lado de SUNAT dice que no es nuestro", () => {
    assert.match(mensajeDeEstado(500)!, /de su lado/);
    assert.match(mensajeDeEstado(503)!, /de su lado/);
  });

  // Un 422 nombra el campo en el cuerpo; taparlo con un texto genérico
  // perdería justamente el dato útil.
  test("el 422 no se traduce: su cuerpo dice más", () => {
    assert.equal(mensajeDeEstado(422), null);
    assert.equal(mensajeDeEstado(404), null);
  });
});
