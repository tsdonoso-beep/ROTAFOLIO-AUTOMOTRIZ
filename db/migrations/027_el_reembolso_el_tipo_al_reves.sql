-- El reembolso, el único tipo que va al revés
--
-- Los otros cuatro tipos entregan plata y después piden cuentas. El
-- reembolso empieza por las cuentas: la persona ya pagó de su bolsillo y
-- pide que le devuelvan. Los comprobantes van ANTES de la aprobación, no
-- después.
--
-- Entra al enum con una advertencia escrita: no hay ni un solo documento de
-- respaldo. Se buscó en las diecisiete hojas del seguimiento y lo que hay es
-- «devolución de saldo» y «reintegro de efectivo», que son plata que vuelve
-- a la empresa —exactamente lo contrario—. El tipo existe porque la jefatura
-- lo nombró en la pizarra, y hasta que aparezca un caso real el modelo es
-- una hipótesis, no un hecho.

alter type tipo_memo add value if not exists 'REEMBOLSO';
