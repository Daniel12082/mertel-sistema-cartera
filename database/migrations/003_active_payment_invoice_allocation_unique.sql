-- ============================================================
-- MIGRACIÓN 003 — UNICIDAD DE ASIGNACIONES ACTIVAS
-- ============================================================
-- MySQL permite varias filas NULL dentro de un índice UNIQUE.
-- La columna generada solo contiene invoice_id si la asignación
-- está activa; las filas revertidas conservan historial sin
-- participar en la unicidad de parejas activas.

ALTER TABLE payment_allocations
    DROP INDEX uk_payment_invoice,
    ADD COLUMN active_invoice_id BIGINT UNSIGNED
        GENERATED ALWAYS AS (
            CASE WHEN deleted_at IS NULL THEN invoice_id ELSE NULL END
        ) VIRTUAL,
    ADD UNIQUE KEY uk_payment_invoice_active (payment_id, active_invoice_id);
