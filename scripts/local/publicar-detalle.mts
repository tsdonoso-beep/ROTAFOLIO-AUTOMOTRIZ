// Rehacer «COMPROBANTES SUNAT - DETALLE» con lo que ya está en la base, sin
// preguntarle nada a SUNAT. Para cuando cambian las columnas de la hoja (o
// lo que se le cruza, como la carpeta madre) y no hay comprobantes nuevos:
// `cpe:local` solo publica si guardó algo.
//
//   npm run hojas:detalle

import { crearBitacora } from "./comun/bitacora.mts";
import { publicarDetalle } from "./comun/guardar.mts";

const b = crearBitacora("publicar-detalle");
await publicarDetalle(b);
