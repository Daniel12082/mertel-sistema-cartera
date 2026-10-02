-- FASE 4.6B: login interno por username, conservando email y usuarios existentes.
-- Nullable para que los usuarios actuales sigan autenticándose mediante email.
ALTER TABLE users
    ADD COLUMN username VARCHAR(50) NULL AFTER last_name,
    ADD UNIQUE KEY uk_users_username (username);
-- Reversión manual (retira el login por username):
-- ALTER TABLE users DROP INDEX uk_users_username, DROP COLUMN username;
