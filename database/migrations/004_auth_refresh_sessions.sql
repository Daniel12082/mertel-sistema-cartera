-- FASE 4.6A: sesiones, sin modificar usuarios existentes.
-- Las rotaciones conservan hashes revocados para detectar reutilización.
CREATE TABLE auth_refresh_sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    revoked_at DATETIME(3) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_auth_refresh_token_hash (token_hash),
    KEY idx_auth_refresh_family (family_id),
    KEY idx_auth_refresh_user (user_id),
    KEY idx_auth_refresh_expiration (expires_at),
    CONSTRAINT fk_auth_refresh_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reversión manual al retirar la funcionalidad:
-- DROP TABLE auth_refresh_sessions;
-- Termina sesiones refresh; no altera users ni audit_logs.
