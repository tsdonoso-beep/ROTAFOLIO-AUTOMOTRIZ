// El token Bearer de api-cpe: se lee de las peticiones que hace la propia app de SUNAT.

import type { BrowserContext } from "playwright";
import { dormir } from "../comun/bitacora.mts";
import { expiracionJwt } from "../comun/tipos.mts";
import { ErrorSesion } from "./sesion.mts";

/**
 * El token Bearer con que la app «Nueva Consulta» llama a api-cpe.sunat.gob.pe.
 * Se lee de las cabeceras de sus propias peticiones; vive solo en memoria.
 */
export class Token {
  valor: string | null = null;
  expira: number | null = null; // segundos epoch
  vigilar(ctx: BrowserContext): void {
    ctx.on("request", req => {
      if (!/api-cpe\.sunat\.gob\.pe/i.test(req.url())) return;
      const a = req.headers()["authorization"];
      if (a && a !== this.valor) {
        this.valor = a;
        this.expira = expiracionJwt(a);
      }
    });
  }
  vigente(margenS = 60): boolean {
    return !!this.valor && (this.expira === null || this.expira - margenS > Date.now() / 1000);
  }
  async esperar(ms = 30000): Promise<string> {
    const fin = Date.now() + ms;
    while (Date.now() < fin) {
      if (this.valor) return this.valor;
      await dormir(250);
    }
    throw new ErrorSesion("la app no llamó a api-cpe: no hay token");
  }
}
