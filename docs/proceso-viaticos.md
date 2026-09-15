# El proceso de viáticos y rendiciones

Todo lo que sabemos del proceso real, con la evidencia que lo sostiene. Es la
base de la que salen las decisiones de diseño de INRO VIÁTICOS.

**Regla de este documento:** cada afirmación dice de qué documento sale. Lo que
no tiene fuente va marcado como supuesto. Nadie debería construir sobre un
supuesto creyendo que está verificado — es como se pierden semanas.

Última revisión: 15 de setiembre de 2026.
Mapa navegable del mismo contenido: `docs/viaticos-as-is-y-to-be.html`.

---

## 1. Quién es quién

| Persona | Qué hace | Cómo lo sabemos |
|---|---|---|
| **Kory Sobrino** `k.sobrino@` | Manda 220 de los 423 memos (52%) | MemoTracker |
| **Annie Mantilla** `a.mantilla@` | Manda 182 memos (43%). Administra caja chica | MemoTracker · memo 194-2026 |
| **Jenny Barreto Panez** | Tesorería. Firma y envía las planillas de pago | Constancia BCP 1439 |
| **Liliana Montero Torrejón** | Gerente de Administración y Finanzas. Destinataria de todos los memos | Memos 594 y 194 |
| **José Carlos Haertel Siguas** | Project Manager. Firma memos y autoriza planillas de movilidad | Memos · planilla 009979 |
| **Rosa** | Contabilidad. Registra en CONCAR (subdiarios 11, 21, 31) | Entrevistas |
| **David** | Costos y Control de Gestión. Arma presupuestos y revisa rendiciones | Entrevistas |
| **Carolina Zapata** | Finanzas. Caja chica administrativa | Entrevistas · MemoTracker |
| **Mell Ferrer** | Administrador de caja con más movimiento (2,288 líneas) | Seguimiento CdG |
| **Franco** | Finanzas. Autor de MemoTracker, InroPay, fianzas, cobranzas | Reunión de automatizaciones |
| **Norma** | Eligió viáticos como el proceso por donde empezar | Entrevistas |

Otros administradores de caja: Camila GR (88), Fernando Aroni (67), Manuel
Flores (66), Allison Solano (58). Otros remitentes de memos: Mitzi Noriega,
Felipe Carrascal, Alonzo Huanca, Araceli Villareal, Mell Ferrer, Postventa —
21 memos entre los nueve.

**Sin confirmar:** «Gianfranco» aparece en la reunión como autor del cuadro de
aprobaciones de compras y parece ser una persona distinta de Franco. Y el
sistema interno que mantiene Roberto se transcribió como CDGE/SIDIGE/SIGE sin
que quede claro el nombre.

---

## 2. Los sistemas que ya existen

Ninguno es nuestro y ninguno hay que reemplazar.

**MemoTracker** (Franco · Apps Script + Gmail + Google Sheets)
Lee el buzón, reconoce el memo, guarda una fila, detecta la aprobación en el
hilo, crea la carpeta en Drive y archiva lo que llegue después por ese mismo
hilo. 423 memos entre el 19 de marzo y el 15 de setiembre de 2026.

**InroPay** (Franco · tesorería)
Emite las alertas de pago que MemoTracker anota. Franco quiere invertir el
sentido: que el memo aprobado le llegue a Tesorería como pendiente de revisión
y se registre solo si está conforme. *Todavía no existe.*

**Seguimiento de cajas chicas y viáticos** (Control de Gestión · Excel, 17 hojas)
Es la aplicación entera, sostenida a mano: estado de cuentas, memos por
responsable, memos por persona, 9,470 líneas de rendición, ubicación del
personal, movimientos bancarios, matriz de observaciones, proveedores con
tarifas negociadas, estados de contrato y un tablero de alertas.

**CONCAR** — contabilidad. Subdiarios 11 (compras), 21 (devolución), 31 (rendición).
**SIRE** — SUNAT. Se libera el día 8 de cada mes.

---

## 3. El flujo real

### 3.1 Quién pide el memo

**No es el trabajador.** El circuito de correo no lo toca en ningún punto:
no pide, no recibe, no responde.

La necesidad nace del viaje, la jefatura la autoriza **por fuera de todo
sistema** —en una conversación que no deja rastro— y una de dos personas la
convierte en memo. El memo va firmado por la jefatura del proyecto y dirigido
a la Gerencia de Administración y Finanzas.

En el 594-2026: lo firma José Haertel, lo manda Kory, y los siete trabajadores
que viajaron no aparecen en ninguna parte.

### 3.2 Un memo cubre a una cuadrilla

El 594-2026 asigna a **once personas**, con **tres tramos de fecha distintos**
dentro del mismo memo:

| Personas | Tramo | Monto c/u |
|---:|---|---:|
| 4 | 09/08 al 10/08 | S/ 212.00 |
| 6 | 09/08 al 19/08 | S/ 1,164.00 |
| 1 | 10/08 al 19/08 | S/ 1,232.00 |

Total S/ 9,064.00, que coincide con el párrafo del memo.

**Esa lógica no se toca.** Un memo, un correo, un pago, varios rendidores.

### 3.3 El pago se parte por banco

La planilla de haberes 1439 pagó **S/ 5,292.00 a siete personas** — y las
siete tienen cuenta BCP, que es de donde sale la planilla. Las cuatro
restantes tienen Interbank y su plata (S/ 3,772.00) sale por otra operación
contra el CCI.

> **Un memo se paga en más de una planilla: una por banco.** Leer una
> constancia no basta; hay que sumarlas hasta cubrir el memo.

La constancia trae el estado por fila (PROCESADA / RECHAZADA). Una fila
rechazada es alguien que no cobró y que por lo tanto no tiene nada que rendir.

### 3.4 La rendición y la devolución

Wilmer Zamora (DNI 73218372), del 594-2026:

```
recibido                          212.00
  facturas          132.90   ← lo único que da crédito fiscal
  planilla movilidad  20.90
  declaración jurada  48.00
rendido                           201.80
devuelto                           10.20   op. 10394730, 27/08 12:08
```

El saldo calza al céntimo. La devolución la transfiere la persona desde su
propia cuenta de ahorros a la de la empresa, y manda la captura.

El formato de rendición separa **«monto rendido (solo FT)»** del total: solo
las facturas dan crédito fiscal, y esa distinción hay que mostrarla.

**Ojo:** los comprobantes de Wilmer son del 10, 11, 14 y 27 de agosto, y su
tramo era del 09 al 10. Hay gastos fuera de su ventana — el rango es por
persona, no por memo, y hoy nadie lo valida.

---

## 4. Los cinco tipos de memo

| Tipo | Frecuencia | Estado |
|---|---|---|
| **Hospedaje** | 65 de 125 (Annie) · 189 asuntos en MemoTracker | Verificado |
| **Viáticos** | 45 de 125 · 150 asuntos | Verificado |
| **Caja chica** | 15 de 125 · 175 ciclos históricos | Verificado |
| **Pasajes** | 6 memos, todos con `memoReferenciado` al padre | Verificado |
| **Transporte** | No es memo: gasto contra caja chica | Verificado |
| **Reembolso** | — | **Sin un solo documento** |

### 4.1 Hospedaje — el más frecuente, y no está en la base
`tipo_memo` no lo tiene. Es el tipo más común que existe.

### 4.2 Pasajes
Memo hijo de un viático. Se emite con la fecha de ida y **se actualiza después
con la de retorno**, porque al abrirlo no se sabe cuándo vuelve la persona. Es
el único campo del sistema que se edita después de aprobado.

### 4.3 Caja chica
Un fondo que **no se cierra: se repone**. Cada reposición abre un memo nuevo.

- **Cadencia real: cada 8 a 12 días**, no mensual como se dijo en la pizarra.
  Los seis ciclos de Gestión de Proyectos: 11 y 23 de julio, 4, 13 y 25 de
  agosto, 3 de setiembre.
- **175 ciclos** registrados entre 2025 y 2026, numerados `NNN-AAAA`.
- **Una sola persona asignada**, con un rol explícito en el anexo:
  «Ejecutor y Administrador de Caja Chica».
- El memo 194-2026 escribe «CAJA CHICA N° 36» y el seguimiento usa `NNN-AAAA`.
  **Hay dos numeraciones y hay que unificarlas.**

### 4.4 Transporte — la planilla de movilidad

Formulario preimpreso de talonario. La planilla 009979 es de Kory Sobrino; la
que usó Wilmer fue la 010212 — misma serie.

- **Cabecera:** trabajador, DNI, período, fecha de emisión, N° de planilla.
- **Por fila:** fecha del gasto (día/mes/año), motivo, destino, monto.
- **Dos firmas: AUTORIZADO (la jefatura) y TRABAJADOR.**
  En la pizarra se dio por hecho que no necesitaba aprobación. Sí la necesita.

**Base legal impresa al pie:** inciso a1) del artículo 37° del TUO de la Ley
del Impuesto a la Renta e inciso v) del artículo 21° de su Reglamento.

> «La falta de consignación de la fecha en que se incurrió en el gasto,
> nombres y apellidos de cada trabajador, número de DNI, motivo y destino del
> desplazamiento y monto gastado, respecto a cada desplazamiento **sólo
> inhabilita la planilla para la sustentación del gasto que corresponde a tal
> desplazamiento**».

**Se cae la fila, no la planilla.** Es exactamente cómo la app trata los
gastos: alerta por comprobante y devolución parcial al trabajador.

### 4.5 Reembolso
La persona ya pagó de su bolsillo y pide que le devuelvan. **Es el único tipo
donde el orden se invierte:** los comprobantes van antes de la aprobación.

No hay ni un documento. Lo busqué en las 17 hojas del seguimiento: hay
«devolución de saldo» y «reintegro de efectivo», que son plata que vuelve a la
empresa — lo contrario de un reembolso.

---

## 5. Los números que importan

### 5.1 La deuda viva
De 520 memos-persona y 94 personas, en lo que va del año:

| | |
|---|---:|
| Abonado al personal | S/ 295,564.00 |
| Rendido | S/ 210,432.21 |
| **Diferencia** | **S/ 85,131.79** |

**109 de 520 están «POR REGULARIZAR»** — uno de cada cinco. El tablero del
propio seguimiento tiene un caso con **154 días** de atraso.

Estados que usa Control de Gestión: PRESENTADO 325 · POR REGULARIZAR 109 ·
VIGENTE 72 · EN REVISIÓN 7 · OBSERVADO 5 · REVISADO 2.

### 5.2 Qué se observa en la realidad
De las 23 observaciones registradas:

- **Factura duplicada — 12**
- **Boleta duplicada — 10**
- DJ eliminada — 1

**22 de 23 son duplicados.** La alerta de comprobante repetido que ya está
construida cubre el 96% de lo que Control de Gestión observa. Con plata real
detrás: el memo 005-2026 tiene S/ 1,147 pendientes de devolver y el 044-2026,
S/ 1,064.70.

### 5.3 Qué documentos se rinden

De 6,197 líneas con tipo (hoja Data Rendiciones):
FACTURA 3,923 · BOLETA 1,144 · **DJ 855** · **PLANILLA DE MOVILIDAD 274**

De 3,593 líneas de la hoja de caja, aparecen seis tipos más:
TICKET 86 · RECIBO 85 · VOUCHER 23 · EFECTIVO 15 · RECIBO POR HONORARIOS 14 ·
CONSTANCIA DE TRANSFERENCIA 5 · **YAPE 4**

> Los fiscales caben en `clase_gasto = COMPROBANTE` con su `tipo_comprobante`.
> Yape, efectivo, voucher y constancia **no son documentos fiscales** y tienen
> que poder guardarse solo con monto y foto.

### 5.4 SIRE — lo que SUNAT sí y no trae
13,095 comprobantes, 9 períodos, RUC 20512201611:

| Tipo | Filas | Monto |
|---|---:|---:|
| 01 Factura | 12,534 | S/ 20.9 M |
| 07 Nota de crédito | 286 | −S/ 2.1 M |
| 53 Courier | 180 | S/ 0.5 M |
| **50 DUA importación** | **87** | **S/ 12.8 M** |
| 54 Liquidación de cobranza | 6 | S/ 3 K |
| 08 Nota de débito | 2 | S/ 32 K |

- **87 documentos son el 37% del monto del año.** Son las importaciones.
- **Cero recibos por honorarios y cero boletas.** El RCE propuesta trae lo que
  da crédito fiscal más lo aduanero. La fuente secundaria (correo / Drive de
  contabilidad) no es opcional.
- **Detracción: NULL en las 13,095 filas.** Pendiente sin resolver.
- **Retención:** no hay tipo 20 en el RCE. Necesita otra fuente.
- SIRE trae la **cabecera**, no el detalle por ítem. Para clasificar por
  concepto, trazar con Cardex o casar con la orden de compra hace falta el XML.

**Notas de crédito:** 273 calzan con su factura (95%), 247 anulan el total, y
**46 llegaron en un mes posterior al de la factura, por S/ 562,079** — el caso
en que la factura pudo estar pagada cuando apareció la nota que la anula.

---

## 6. Dónde se rompe hoy

Trece puntos, de los cuales la app cierra siete, atenúa cuatro y no toca dos.

1. **El plan del viaje cambia a mitad de camino.** Coordinación, no software.
2. **Memos encadenados.** Se abre uno nuevo sin rendir el anterior. Hubo un caso
   con ~50 acumulados y ~S/ 1,900 de devolución.
3. **Nadie controla que rindan.** Control de Gestión persigue. Sábados y domingos.
4. **Gastos sin comprobante posible.** En provincia hay proveedores que cobran
   más por facturar, y los comprobantes térmicos se borran solos.
5. **Proyecto mal asignado.** Un memo se reparte entre proyectos y la glosa
   llega por persona.
6. **Llega en papel y desordenado** a Contabilidad.
7. **Reposición bloqueada.** Sin cierre no sale el fondo del viaje siguiente.
8. **Reglas no escritas.** *Resuelto: estaban impresas al pie de la planilla.*
9. **Registro uno por uno** en CONCAR, hasta 200 líneas.
10. **El memo no dice quién rinde.** El anexo vive dentro del Word y nadie lo
    abre. Por eso el control de rendiciones de Franco excluye viáticos.
11. **La revisión no se registra.** Las columnas «Fecha de envío a Tesorería» y
    «VB Finanzas» dicen `#REF!` en **395 de 423** filas. Existía y se rompió.
12. **Dos personas mandan el 95% de los memos.**
13. **Donde escribe una persona, se escribe mal.** Cuatro casos medidos:
    - El asunto no trae el número en **341 de 422** memos
    - 7 correlativos malformados: `PASAJE 429-2026`, uno convertido en fecha
    - La devolución dice `Memo 594,2026` — con coma en vez de guion
    - El memo 194-2026 dice **S/ 500.00** en el párrafo y **S/ 1,500.00** en el
      anexo. El seguimiento confirma 1,500: el párrafo era el error. Salió,
      se aprobó y se pagó igual.

---

## 7. Decisiones tomadas

1. **El correlativo mantiene el formato `NNN-AAAA`** y lo genera la app, como
   emisor único. Queda descartado `INROPRIN-2026-VIA-00001`: el MemoTracker
   reconoce el memo por ese patrón y cambiarlo lo deja ciego.
2. **La llave de integración es el `threadId`**, único en los 423 registros.
   **El número de memo no identifica un memo** — hay 10 repetidos dentro de la
   hoja y al menos una colisión que la hoja ni registra (194-2026 es un memo de
   caja chica del 1 de abril y un hospedaje a Mollendo del 6 de julio).
3. **Se lee la hoja de Franco, no sus correos.** Su hoja ya trae todo, y no
   exige que toque su código. El webhook queda para cuando la demora moleste.
4. **Nunca escribimos en su archivo.** Publicamos el nuestro y él lo jala.
5. **Un memo, varias personas asignadas.** No hay dos niveles de solicitud.
6. **La reposición de caja chica abre un memo nuevo** que apunta al anterior,
   usando el mecanismo que su hoja ya tiene (`memoReferenciado`).
7. **Las cuentas bancarias viven en la ficha de la persona**, no copiadas en
   cada memo, visibles solo para quien arma memos y Tesorería. Ya es así en la
   hoja de estados de contrato del seguimiento.
8. **La app genera el memo y lo adjunta con el nombre exacto**
   `Memo NNN-AAAA - CONCEPTO - ÁREA`. Es el nombre del adjunto —no el asunto—
   lo que el MemoTracker lee.
9. **El monto del párrafo se calcula**, es la suma del anexo. Nunca se escribe.

---

## 8. Decisiones abiertas

| Qué | Quién decide |
|---|---|
| El tope diario de movilidad: el porcentaje de la RMV y la RMV vigente | Contabilidad (Rosa) |
| Si el excedente de movilidad se parte al mes siguiente | Contabilidad |
| Si la planilla de movilidad sigue usando los números del talonario o pasa a una serie propia | Contabilidad |
| Unificar la numeración de caja chica: «N° 36» vs `NNN-AAAA` | Control de Gestión |
| Si el control de rendiciones vencidas avisa o **frena** | Dirección |
| Dónde queda registrada la autorización de jefatura, que hoy no deja rastro | Dirección |
| Todo el flujo de reembolso | Falta un caso real |

---

## 9. Lo que falta pedir

**A Franco** — lectura de la hoja del MemoTracker y de la carpeta donde InroPay
archiva las constancias. Y avisarle del `#REF!` en 395 de 423 filas.

**A Sistemas / Workspace** — autorizar a la cuenta de servicio a enviar correo
en nombre del usuario. Es el único permiso nuevo del diseño.

**A Kory y a Annie** — media hora viéndolas armar un memo. Entre las dos mandan
el 95% de los memos del año.

**A quien haya pedido uno** — un reembolso cualquiera, con su correo y su
comprobante. Es el último tipo sin verificar.

---

## 10. Cómo se conecta con el MemoTracker

Cinco conexiones. **Ninguna obliga a Franco a cambiar su herramienta.**

| # | Qué mueve | Cómo | Estado |
|---|---|---|---|
| 1 | La solicitud del memo (app → MemoTracker) | Gmail API, desde el buzón de quien pide, con el memo adjunto nombrado exacto | Por construir |
| 2 | Aprobación, carpeta y pago (MemoTracker → app) | Leer su Sheet por `threadId` | Se puede hoy |
| 3 | Las personas y sus montos (InroPay → app) | El PDF del banco es **texto, no escaneo**: se lee sin OCR ni IA. Se suman las planillas hasta cubrir el memo | Probado |
| 4 | Estado de rendición (app → MemoTracker) | Publicamos nuestra hoja; él la jala con `IMPORTRANGE` | Por construir |
| 5 | Comprobantes y notas de crédito (SIRE → app → todos) | Cron diario 8am | Funcionando |

**Descartado:** Gmail push con Pub/Sub — infraestructura nueva para ganar
minutos sobre un proceso que hoy tarda días.

---

## 11. Estado de nuestra base

Al 15 de setiembre de 2026, en producción:

```
memos              4      usuarios          99
memo_asignados     4      cecos activos      8
gastos             4      proyectos          0   ← bloqueante
liquidaciones      0      empresas           1
comprobantes_sunat 13,095
```

Enumeraciones actuales:

- `tipo_memo` — VIATICOS, PASAJES, CAJA_CHICA, OTRO
- `clase_gasto` — COMPROBANTE, DECLARACION_JURADA, MOVILIDAD
- `estado_memo` — BORRADOR, ABIERTO, EN_RENDICION, PRESENTADA, OBSERVADA,
  APROBADA, CONTABILIZADA, CERRADO, ANULADO
- `estado_gasto` — CAPTURADO, EXTRAIDO, ERROR_EXTRACCION, CON_ALERTA, VALIDADO,
  PRESENTADO, OBSERVADO, APROBADO, CONTABILIZADO
- `rol_usuario` — RENDIDOR, ADMIN_MEMOS, REVISOR_COSTOS, CONTABILIDAD,
  JEFATURA, ADMIN_SISTEMA

---

## 12. Los cambios pendientes

Ordenados por lo que desbloquean, no por tamaño.

### Migraciones

1. **`memo_asignados` necesita `monto`, `fecha_desde` y `fecha_hasta`.**
   Hoy guarda solo el par memo↔persona. Sin esto no se puede reproducir el
   anexo, ni calcular el saldo de cada quien, ni cruzar contra la planilla. El
   594-2026 tiene tres montos y tres tramos distintos en el mismo memo.
2. **`tipo_memo` += `HOSPEDAJE`** — el tipo más frecuente que existe.
   Evaluar también `REEMBOLSO` cuando llegue un caso.
3. **`estado_memo` += un estado para el vencido sin rendir** («POR REGULARIZAR»
   en el seguimiento: 109 de 520).
4. **Cargar los 7 proyectos** con su código, centro de costo y abreviatura. Hoy
   hay cero y `memo_distribucion` cuelga de eso.
5. **Tabla de caja chica**: número de ciclo, responsable, fondo, y el enlace al
   ciclo anterior.
6. **Cuenta bancaria, CCI y banco en `usuarios`**, con RLS que los limite a
   ADMIN_MEMOS y Tesorería.
7. **Planilla de movilidad como contenedor**: número de planilla y firma de
   autorización, con una fila de gasto por desplazamiento.
8. **Tabla de proveedores** con la tarifa negociada por zona y servicio
   (hospedaje S/ 70, pasaje terrestre S/ 15) — habilita la alerta de «cobraron
   más de lo acordado».

### Features

9. **Lector de constancias de pago** — suma planillas por banco hasta cubrir el
   memo; mientras no lo cubra, «pagado en parte» con los nombres de quién falta.
10. **Importar los 423 memos** por `threadId`, con su carpeta y sus fechas.
11. **Importar las 9,470 líneas de rendición** históricas.
12. **Generador del memo** en Word, con el nombre de archivo exacto.
13. **Emisión del correo** como el solicitante (Gmail API).
14. **Conexión viva con la hoja del MemoTracker.**
15. **Publicar el estado de rendición** para que Franco lo jale.
16. **Pestaña de notas de crédito** en la hoja de SUNAT — Franco la pidió y las
    273 ya están calzadas.
17. **Validar la fecha del comprobante contra el tramo de la persona**, no
    contra el del memo.
18. **Alerta de tarifa excedida** contra la tabla de proveedores.
19. **Tope diario de movilidad** como parámetro configurable.
20. **Mostrar el total rendido y, aparte, lo que da crédito fiscal.**

### Deuda conocida, anterior a todo esto

- **Detracción en NULL** en las 13,095 filas de SUNAT.
- Tipos 50 / 53 / 54 sin nombre en la hoja publicada.
- RUCs de consorcio: bloquean 3 de los 8 CECOs activos.
- **Forzar cambio de contraseña a los 98 usuarios** que comparten la del piloto.
- Error de lint preexistente en `components/ApiKeyConfig.tsx`.

---

## 13. Las fuentes

| Documento | Qué aporta |
|---|---|
| `REGISTROS - MEMOTRACKER.xlsx` | 423 memos, mar–set 2026 |
| `Memo 594-2026 ... .docx` | Memo de viáticos con anexo de 11 personas |
| `Memo 194-2026 CAJA CHICA ... .docx` | Memo de caja chica |
| `PAGO MEMO 594-2026 VIATICOS.pdf` | Planilla BCP 1439, 7 beneficiarios |
| Captura de la devolución | S/ 10.20, op. 10394730 |
| `FORMATO ENTREGA A RENDIR.xlsx` | Rendición de Wilmer + catálogo de proyectos |
| `SEGUIMIENTO DE CAJAS CHICAS Y VIATICOS 2026.xlsx` | 17 hojas · 520 memos-persona · 9,470 rendiciones |
| Planilla de movilidad N° 009979 | Formato, firmas y base legal |
| Entrevistas con Rosa, Carolina y David | El As Is |
| Reunión con Franco | MemoTracker, InroPay y el resto de sus automatizaciones |
| Sesión de pizarra con jefatura | Los cinco tipos y el circuito de aprobación |
