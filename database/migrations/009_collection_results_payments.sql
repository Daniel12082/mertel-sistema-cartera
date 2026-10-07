-- Reuse the financial ledger and operational actions. No parallel payment/report ledger.
ALTER TABLE payments
  ADD COLUMN operation_key CHAR(64) NULL,
  ADD COLUMN operation_payload_hash CHAR(64) NULL,
  ADD UNIQUE KEY uk_payments_operation (company_id,operation_key);

ALTER TABLE collection_actions
  ADD COLUMN reported_amount DECIMAL(15,2) NULL,
  ADD COLUMN reported_payment_date DATE NULL,
  ADD COLUMN reviewed_by BIGINT UNSIGNED NULL,
  ADD COLUMN reviewed_at DATETIME NULL,
  ADD COLUMN review_reason TEXT NULL,
  ADD COLUMN confirmed_payment_id BIGINT UNSIGNED NULL,
  ADD COLUMN operation_key CHAR(64) NULL,
  ADD COLUMN operation_payload_hash CHAR(64) NULL,
  ADD UNIQUE KEY uk_collection_actions_operation (company_id,operation_key),
  ADD KEY idx_collection_payment_reports (company_id,action_type,status),
  ADD CONSTRAINT fk_collection_confirmed_payment FOREIGN KEY (confirmed_payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_collection_report_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;
