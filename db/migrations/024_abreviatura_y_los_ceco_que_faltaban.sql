-- La abreviatura del centro de costo, y los tres que no estaban
--
-- Al cruzar el catálogo de Control de Gestión contra la base aparecieron dos
-- cosas.
--
-- La primera: los centros de costo de la base YA SON los proyectos. Sus
-- códigos son PROY-2025-079-5, PROY-2025-146… los mismos que usa Control de
-- Gestión. En su vocabulario «código de proyecto» y «centro de costo» son
-- las dos columnas del mismo renglón: el código y el nombre.
--
-- La segunda: faltaban tres, y entre ellos el más grande.
--
--     PROY-2025-077-3   PRONIED - TALLERES EPT I y II
--     PROY-2025-164-2   TALLERES ESPECIALIZADOS LIMA PROVINCIAS
--     PROY-2025-164-3   LIMA PROVINCIAS - BTD
--
-- El primero es el proyecto del memo de caja chica 194-2026 y el de buena
-- parte de los memos del año. Sin él, esos memos no tenían dónde imputarse.
--
-- La abreviatura no es decoración: es como Control de Gestión los nombra en
-- sus reportes y en las conversaciones. Un memo que dice «TALLERES EPT» se
-- reconoce; uno que dice «PROY-2025-077-3» hay que ir a buscarlo.

alter table centros_costo add column abreviatura text;

comment on column centros_costo.abreviatura is
  'Como lo nombra Control de Gestión en sus reportes. Sale de su catálogo, no se inventa.';

insert into centros_costo (codigo, nombre, empresa_id, activo)
select v.codigo, v.nombre, (select id from empresas where ruc = '20512201611'), true
from (values
  ('PROY-2025-077-3', 'PRONIED - TALLERES EPT I y II'),
  ('PROY-2025-164-2', 'TALLERES ESPECIALIZADOS LIMA PROVINCIAS'),
  ('PROY-2025-164-3', 'LIMA PROVINCIAS - BTD')
) as v(codigo, nombre)
where not exists (select 1 from centros_costo c where c.codigo = v.codigo);

update centros_costo c set abreviatura = v.abreviatura
from (values
  ('PROY-2025-077-3', 'TALLERES EPT'),
  ('PROY-2025-079-5', 'TALLERES ESP'),
  ('PROY-2025-196',   'TALLER ESP - IE JUAN ESPINOZA'),
  ('PROY-2025-164-2', 'TALLER ESP - IE PEDRO PAULET'),
  ('PROY-2025-164-3', 'TALLER ESP - 11 IE'),
  ('PROY-2025-146',   'LPI - PMESUT - PULIDORA'),
  ('PROY-2025-011-1', 'PAQ 08 - TEC'),
  ('PROY-2025-011-2', 'PAQ 08 - INT')
) as v(codigo, abreviatura)
where c.codigo = v.codigo;

-- El catálogo de Control de Gestión usa «TALLER ESP - IE PEDRO PAULET» para
-- PROY-2025-196 y para PROY-2025-164-2. Dos proyectos, una sola abreviatura.
-- Acá se deja la del 196 apuntando al colegio que su propio nombre declara
-- —IE Juan Espinoza Medrano— y queda anotado para confirmarlo con ellos:
-- si la abreviatura es lo que sale en los reportes, dos iguales significa que
-- alguien está sumando cosas distintas en la misma fila.
create unique index centros_costo_abreviatura_unica
  on centros_costo (abreviatura) where abreviatura is not null;
