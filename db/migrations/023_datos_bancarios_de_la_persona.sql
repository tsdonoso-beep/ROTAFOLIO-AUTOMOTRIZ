-- La cuenta bancaria vive en la persona, no en el memo
--
-- El anexo del memo imprime el banco, la cuenta y el CCI de cada asignado, así
-- que la aplicación no puede generarlo sin ese dato. La pregunta nunca fue si
-- guardarlo, sino dónde: el número de cuenta no cambia de un memo a otro.
-- Es de la persona, igual que su DNI.
--
-- Hoy vive copiado en cada Word. El anexo del memo 594-2026 lleva las cuentas
-- completas y los CCI de once personas, en un archivo que circula por correo y
-- queda en una carpeta compartida. Concentrarlo en un solo lugar con permisos
-- no es solo más ordenado: son menos copias dando vueltas.
--
-- Va en su propia tabla y no como columnas de `usuarios` por una razón
-- concreta: las políticas de RLS son por FILA, no por columna. La política de
-- lectura de `usuarios` deja ver a toda persona con rol JEFATURA, y una
-- jefatura no tiene por qué ver cuentas bancarias. Separando la tabla, el
-- permiso se puede acotar de verdad.

create table datos_bancarios (
  usuario_id       uuid primary key references usuarios(id) on delete cascade,
  banco            text not null,
  cuenta           text not null,
  -- El código interbancario. Es el que hace falta cuando el pago NO sale por
  -- la planilla de haberes: esa solo alcanza a quien tiene cuenta en el mismo
  -- banco que la empresa. En el memo 594-2026, cuatro de las once personas
  -- tenían Interbank y su plata salió por otra vía, contra este código.
  cci              text,
  actualizado_por  uuid references usuarios(id),
  actualizado_en   timestamptz not null default now()
);

comment on table datos_bancarios is
  'Dónde cobra cada persona. Tabla aparte de usuarios porque RLS es por fila y esto necesita un permiso más estrecho.';

alter table datos_bancarios enable row level security;

-- Quien arma memos lo necesita para generar el anexo. Nadie más: ni la
-- jefatura que aprueba, ni quien revisa la rendición, ni Contabilidad.
-- Si Tesorería llega a necesitarlo dentro de la aplicación, se le agrega su
-- propio rol en vez de ensanchar este.
create policy datos_bancarios_lectura on datos_bancarios for select
  using (
    usuario_id = (select seguridad.usuario_actual())
    or seguridad.tiene_rol('ADMIN_MEMOS')
    or seguridad.tiene_rol('ADMIN_SISTEMA')
  );

create policy datos_bancarios_escritura on datos_bancarios for all
  using (seguridad.tiene_rol('ADMIN_MEMOS') or seguridad.tiene_rol('ADMIN_SISTEMA'))
  with check (seguridad.tiene_rol('ADMIN_MEMOS') or seguridad.tiene_rol('ADMIN_SISTEMA'));
