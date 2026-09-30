// Genera db/database.full.sql: todas las migraciones de db/migrations/, en orden, en un solo archivo.
//
//   pnpm db:consolidar            (regenerarlo después de agregar una migración)
//   pnpm db:consolidar --revisar  (falla si el archivo quedó desactualizado; para CI)
//
// Corrido sobre una base vacía de Supabase, deja el esquema como está hoy:
// tablas, políticas de fila y la versión vigente de cada función (la última
// migración que la toca gana, igual que al aplicarlas una por una). Es solo
// ESTRUCTURA: los datos viven en Supabase y se respaldan aparte.

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const DIR = join(process.cwd(), "db", "migrations");
const SALIDA = join(process.cwd(), "db", "database.full.sql");

export function consolidar(archivos: Array<{ nombre: string; sql: string }>): string {
  const huella = createHash("sha256");
  for (const a of archivos) huella.update(a.nombre).update("\0").update(a.sql);
  const partes = [
    "-- ════════════════════════════════════════════════════════════════",
    "-- database.full.sql — GENERADO, no editar a mano (pnpm db:consolidar)",
    `-- ${archivos.length} migraciones: ${archivos[0]?.nombre ?? "-"} → ${archivos[archivos.length - 1]?.nombre ?? "-"}`,
    `-- huella: ${huella.digest("hex").slice(0, 16)}`,
    "--",
    "-- Aplicar sobre una base VACÍA (proyecto nuevo de Supabase): SQL Editor →",
    "-- pegar todo → Run. Para una base existente, aplicar solo las migraciones",
    "-- que falten, una por una, desde db/migrations/.",
    "-- ════════════════════════════════════════════════════════════════",
    "",
  ];
  for (const a of archivos) {
    partes.push(
      "",
      `-- ┌──────────────────────────────────────────────────────────────`,
      `-- │ ${a.nombre}`,
      `-- └──────────────────────────────────────────────────────────────`,
      "",
    );
    partes.push(a.sql.replace(/^﻿/, "").replace(/\s+$/, ""), "");
  }
  return partes.join("\n") + "\n";
}

export function leerMigraciones(dir = DIR): Array<{ nombre: string; sql: string }> {
  const nombres = readdirSync(dir)
    .filter(n => /^\d{3}_.+\.sql$/.test(n))
    .sort();
  nombres.forEach((n, i) => {
    const esperado = String(i + 1).padStart(3, "0");
    if (!n.startsWith(esperado)) throw new Error(`falta la migración ${esperado} (encontré ${n}): no se consolida con huecos`);
  });
  return nombres.map(nombre => ({ nombre, sql: readFileSync(join(dir, nombre), "utf8") }));
}

if (process.argv[1]?.endsWith("consolidar-db.mts")) {
  const texto = consolidar(leerMigraciones());
  if (process.argv.includes("--revisar")) {
    const actual = existsSync(SALIDA) ? readFileSync(SALIDA, "utf8") : "";
    if (actual !== texto) {
      console.error("✗ db/database.full.sql está desactualizado: corre pnpm db:consolidar");
      process.exit(1);
    }
    console.log("✓ db/database.full.sql al día");
  } else {
    writeFileSync(SALIDA, texto);
    console.log(`✓ ${SALIDA} (${(texto.length / 1024).toFixed(0)} KB)`);
  }
}
