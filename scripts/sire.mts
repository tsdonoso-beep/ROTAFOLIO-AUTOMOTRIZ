// Prueba la cadena completa contra SUNAT, desde tu máquina.
//
// Las credenciales no viven acá ni en el repositorio: se leen del entorno.
//
//   export SUNAT_INROPRIN_CLIENT_ID=…
//   export SUNAT_INROPRIN_CLIENT_SECRET=…
//   export SUNAT_INROPRIN_USUARIO=USUARIOAPI
//   export SUNAT_INROPRIN_CLAVE=…
//
//   node --experimental-strip-types scripts/sire.mts token
//   node --experimental-strip-types scripts/sire.mts propuesta 202607
//
// `token` solo comprueba las credenciales y no encola nada del lado de
// SUNAT: conviene empezar por ahí.

import { writeFileSync } from "node:fs";
import { credencialesDe } from "../lib/sunat/credenciales.ts";
import { obtenerToken } from "../lib/sunat/token.ts";
import { descargarPropuestaRce } from "../lib/sunat/sire.ts";
import { periodoCerradoAnterior, validarPeriodo } from "../lib/sunat/periodo.ts";

const EMPRESA = process.env.SUNAT_EMPRESA ?? "INROPRIN";
const RUC     = process.env.SUNAT_RUC ?? "20512201611";

const [orden, arg] = process.argv.slice(2);

const cred = credencialesDe(EMPRESA, RUC, process.env);
if (!cred.ok) {
  console.error("✗ " + cred.motivo);
  console.error("\n  Las credenciales se leen del entorno, nunca del código.");
  process.exit(1);
}

// Nada de esto debe imprimir un secreto: el registro de una terminal se
// comparte por captura con la misma facilidad que todo lo demás.
const tapado = (s: string) => s.length <= 8 ? "…" : s.slice(0, 4) + "…" + s.slice(-2);
console.log(`empresa ${EMPRESA} · RUC ${RUC} · usuario ${cred.cred.usuario} · client_id ${tapado(cred.cred.clientId)}\n`);

if (orden === "token" || !orden) {
  const t = await obtenerToken(cred.cred);
  const seg = Math.round((t.venceEn - Date.now()) / 1000);
  console.log(`✓ SUNAT dio token. Sirve por ${seg} segundos más.`);
  console.log("  Las credenciales están bien. No se encoló nada.");
  process.exit(0);
}

if (orden === "propuesta") {
  const periodo = arg ?? periodoCerradoAnterior(new Date());
  const v = validarPeriodo(periodo, new Date());
  if (!v.ok) { console.error("✗ " + v.motivo); process.exit(1); }

  console.log(`Bajando la propuesta del RCE del período ${periodo}.`);
  console.log("Son tres pasos con espera en el medio; SUNAT encola el trabajo.\n");

  const r = await descargarPropuestaRce(cred.cred, periodo, {
    tipo: "csv",
    alAvanzar: p => console.log("   · " + p),
  });

  const salida = `/tmp/rce-${RUC}-${periodo}.zip`;
  writeFileSync(salida, Buffer.from(r.contenido));
  const kb = (r.contenido.byteLength / 1024).toFixed(1);
  console.log(`\n✓ ${r.nombre} · ${kb} KB · ticket ${r.ticket}`);
  console.log(`  Guardado en ${salida}`);
  console.log("\n  Recuerda: acá solo están los comprobantes que los proveedores");
  console.log("  declararon CONTRA el RUC de la empresa. Las boletas que el técnico");
  console.log("  pidió a su nombre no aparecen, y eso es esperado.");
  process.exit(0);
}

console.error(`Orden desconocida: «${orden}». Usa «token» o «propuesta [período]».`);
process.exit(1);
