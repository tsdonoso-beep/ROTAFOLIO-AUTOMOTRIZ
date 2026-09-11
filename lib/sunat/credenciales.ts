// Las credenciales de SUNAT, por RUC
//
// Son por contribuyente: cada empresa del grupo —y cada consorcio— tiene su
// propio usuario secundario de Clave SOL y su propio par de credenciales de
// API. Por eso el nombre de la variable lleva la abreviatura de la empresa.
//
// Nunca viven en la base ni en el repositorio. `empresas.sunat_secret_ref`
// guarda solo la referencia —la abreviatura— y esto la resuelve contra el
// entorno del servidor.

export interface CredencialesSunat {
  clientId: string;
  clientSecret: string;
  /** RUC y usuario secundario pegados, que es como SUNAT espera el username. */
  usuario: string;
  clave: string;
  ruc: string;
}

export interface FaltanCredenciales {
  ok: false;
  faltan: string[];
  motivo: string;
}

/**
 * Arma las credenciales de una empresa a partir del entorno.
 *
 * Devuelve qué falta en vez de lanzar: si se cae con "undefined" a mitad de
 * una petición, el mensaje que queda en el registro no dice cuál de las
 * cuatro variables se olvidó nadie de poner.
 */
export function credencialesDe(
  refEmpresa: string, ruc: string, entorno: Record<string, string | undefined>
): { ok: true; cred: CredencialesSunat } | FaltanCredenciales {
  const ref = refEmpresa.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const nombres = {
    clientId: `SUNAT_${ref}_CLIENT_ID`,
    clientSecret: `SUNAT_${ref}_CLIENT_SECRET`,
    usuario: `SUNAT_${ref}_USUARIO`,
    clave: `SUNAT_${ref}_CLAVE`,
  };

  const faltan = Object.values(nombres).filter(n => !(entorno[n] ?? "").trim());
  if (faltan.length) {
    return {
      ok: false,
      faltan,
      motivo: `Faltan en el entorno del servidor: ${faltan.join(", ")}.`,
    };
  }

  return {
    ok: true,
    cred: {
      clientId: entorno[nombres.clientId]!.trim(),
      clientSecret: entorno[nombres.clientSecret]!.trim(),
      usuario: entorno[nombres.usuario]!.trim(),
      clave: entorno[nombres.clave]!,
      ruc: ruc.trim(),
    },
  };
}

/**
 * El `username` que espera SUNAT: el RUC y el usuario secundario pegados,
 * sin separador. Es el detalle que más fácil se equivoca, y falla con un
 * error de credenciales que no dice que el problema es el formato.
 */
export function usuarioSol(ruc: string, usuarioSecundario: string): string {
  const r = ruc.trim();
  const u = usuarioSecundario.trim();
  // Si ya viene pegado desde la variable de entorno, no se duplica el RUC.
  return u.startsWith(r) ? u : `${r}${u}`;
}
