-- Additive migration. No financial tables or approved template content changed.
ALTER TABLE messages
  ADD COLUMN stage VARCHAR(50) NULL,
  ADD COLUMN direction VARCHAR(20) NOT NULL DEFAULT 'outbound',
  ADD COLUMN message_mode VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN idempotency_key CHAR(64) NULL,
  ADD COLUMN scheduled_at DATETIME NULL,
  ADD COLUMN budget_date DATE NULL,
  ADD COLUMN attempts INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN last_attempt_at DATETIME NULL,
  ADD COLUMN next_attempt_at DATETIME NULL,
  ADD COLUMN received_at DATETIME NULL,
  ADD UNIQUE KEY uk_messages_idempotency (company_id,idempotency_key),
  ADD UNIQUE KEY uk_messages_provider_event (company_id,provider,provider_message_id),
  ADD KEY idx_messages_queue (company_id,status,scheduled_at),
  ADD KEY idx_messages_budget (company_id,budget_date,direction);
