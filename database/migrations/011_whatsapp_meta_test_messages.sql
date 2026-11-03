-- Meta test messages are deliberately not customer/portfolio messages.
-- Existing customer-linked history stays unchanged; no financial table is touched.
ALTER TABLE messages MODIFY COLUMN customer_id BIGINT UNSIGNED NULL;
