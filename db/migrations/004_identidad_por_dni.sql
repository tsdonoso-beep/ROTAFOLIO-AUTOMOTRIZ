-- Identidad por documento, no por correo
--
-- La reunión con Finanzas, Control de Gestión y Administración dejó claro
-- que buena parte del personal no tiene correo corporativo: los técnicos
-- usan correo personal y varios no usan correo en absoluto. Había 224
-- cuentas activas contra ~300 personas entre planilla y otras modalidades.
-- Amarrar la identidad al correo dejaba fuera justamente a quienes más
-- rinden viáticos.
--
-- El documento pasa a ser el identificador de negocio. La llave primaria
-- sigue siendo el uuid: todas las tablas ya apuntan a él y un documento
-- puede corregirse (un dígito mal tipeado, un carnet de extranjería que
-- reemplaza a un DNI). Un identificador que puede cambiar no sirve como
-- llave primaria.

alter table usuarios add column dni text;

-- 8 dígitos es el DNI peruano; se admite hasta 12 para no bloquear el alta
-- de un carnet de extranjería, que es más largo.
alter table usuarios add constraint usuarios_dni_formato
  check (dni is null or dni ~ '^[0-9]{8,12}$');

-- Marca los documentos que todavía son de relleno, a la espera del dato
-- real de RRHH. Sin esto, al llegar la lista verdadera no habría forma de
-- distinguir un documento por reemplazar de uno ya confirmado.
alter table usuarios add column dni_provisional boolean not null default false;

-- El correo deja de ser obligatorio: es un dato de contacto, no la
-- identidad. Sigue siendo único cuando existe (Postgres permite varios
-- nulos bajo una restricción de unicidad).
alter table usuarios alter column email drop not null;

comment on column usuarios.dni is
  'Documento de identidad: identificador de negocio, único. Es lo que la persona teclea para entrar y lo que permite cruzar con la planilla de RRHH.';
comment on column usuarios.dni_provisional is
  'true = documento de relleno, pendiente de reemplazo por el dato real de RRHH.';
comment on column usuarios.email is
  'Correo de contacto. Nulo para quien no tiene: no todos en la empresa tienen cuenta.';

-- Documentos de relleno para los usuarios ya existentes. Van marcados como
-- provisionales para que el reemplazo posterior sea dirigido, no adivinado.
update usuarios
set dni = lpad(((random() * 89999999)::bigint + 10000000)::text, 8, '0'),
    dni_provisional = true
where dni is null;

alter table usuarios alter column dni set not null;
alter table usuarios add constraint usuarios_dni_key unique (dni);
