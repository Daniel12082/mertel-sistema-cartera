-- ============================================================
-- MIGRACIÓN 002 — REVERSIÓN LÓGICA DE ASIGNACIONES DE PAGOS
-- ============================================================

ALTER TABLE payment_allocations
    ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER amount;
