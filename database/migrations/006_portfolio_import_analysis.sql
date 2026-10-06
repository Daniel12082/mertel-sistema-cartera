ALTER TABLE import_batches
  ADD COLUMN file_sha256 CHAR(64) NULL,
  ADD INDEX idx_import_batches_company_sha256 (company_id, file_sha256);

ALTER TABLE import_errors
  ADD COLUMN error_code VARCHAR(80) NULL;
