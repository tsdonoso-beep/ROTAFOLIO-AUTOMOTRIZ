/**
 * Configuración de conexión a la base.
 *
 * Estos dos valores NO son secretos: la clave publicable viaja al navegador
 * por diseño y no concede acceso por sí misma. Todo el control lo hacen las
 * políticas de fila —comprobadas: un rendidor solo obtiene sus propias filas
 * y un anónimo no obtiene ninguna—. Exponerla es el modo previsto de uso.
 *
 * Se dejan como valor por defecto para que el despliegue funcione sin
 * configuración previa, pero las variables de entorno tienen prioridad: eso
 * permite apuntar a otra base (pruebas, otra empresa) sin tocar el código.
 *
 * La clave de servicio, en cambio, nunca debe aparecer aquí ni en el cliente.
 */
const POR_DEFECTO = {
  url: "https://vqabgnynidehfqueupki.supabase.co",
  anon: "sb_publishable_bWYu2n_e7XAOYv2OxK5JpA_6Jpw2-p_",
};

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || POR_DEFECTO.url;

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || POR_DEFECTO.anon;
