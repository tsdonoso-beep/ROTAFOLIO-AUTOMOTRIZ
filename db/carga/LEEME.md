# Carga del padrón

`cargar.mjs` y `cargar2.mjs` cargaron la fuente de verdad de INROPRIN:
personas, áreas, jefatura, roles y centros de costo. Van aquí como registro
de lo que se hizo, no como algo que haya que volver a correr tal cual.

Entran con la sesión de un ADMIN_SISTEMA: las políticas de fila ya le
permiten escribir esas tablas, así que no hace falta clave de servicio.

Corren en seco por defecto; `--escribir` es lo que aplica.

## Dos cosas que se aprendieron corriéndolos

**No borres y reinsertes los roles de quien está ejecutando.** El primer
intento hacía `delete` y luego `insert` por persona. Al llegar a la propia
cuenta se quedó un instante sin `ADMIN_SISTEMA` y la política le negó su
propia reinserción. Ahora se trabaja por diferencia —se agrega lo que falta
y se quita lo que sobra— y nunca se quita el rol con el que uno entró.

**Cambiar el DNI cambia el alias de acceso.** `usuarios.dni` y
`auth.users.email` tienen que moverse juntos. La migración 014 es la que
realinea; sin ella, quien cambió de documento no puede entrar.
