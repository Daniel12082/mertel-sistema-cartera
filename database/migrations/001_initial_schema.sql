-- ============================================================
-- MERTEL SISTEMA DE CARTERA
-- Migración 001 - Esquema inicial
-- MySQL 8.4+
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- EMPRESAS
-- Preparada para soportar múltiples empresas en el futuro
-- ============================================================

CREATE TABLE companies (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(150) NOT NULL,
    legal_name VARCHAR(200) NULL,
    tax_id VARCHAR(50) NULL,
    email VARCHAR(150) NULL,
    phone VARCHAR(50) NULL,
    address VARCHAR(255) NULL,
    city VARCHAR(100) NULL,
    country VARCHAR(100) NOT NULL DEFAULT 'Colombia',
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_companies_tax_id (tax_id),
    KEY idx_companies_status (status)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- ROLES
-- ============================================================

CREATE TABLE roles (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(80) NOT NULL,
    description VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uk_roles_name (name)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- USUARIOS
-- ============================================================

CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    company_id BIGINT UNSIGNED NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NULL,
    email VARCHAR(150) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    last_login_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_users_email (email),
    KEY idx_users_company (company_id),
    KEY idx_users_status (status),

    CONSTRAINT fk_users_company
        FOREIGN KEY (company_id)
        REFERENCES companies(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- RELACIÓN USUARIOS / ROLES
-- ============================================================

CREATE TABLE user_roles (
    user_id BIGINT UNSIGNED NOT NULL,
    role_id BIGINT UNSIGNED NOT NULL,

    PRIMARY KEY (user_id, role_id),

    CONSTRAINT fk_user_roles_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_user_roles_role
        FOREIGN KEY (role_id)
        REFERENCES roles(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- CLIENTES
-- ============================================================

CREATE TABLE customers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    company_id BIGINT UNSIGNED NULL,
    nit VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    phone VARCHAR(50) NULL,
    email VARCHAR(150) NULL,
    address VARCHAR(255) NULL,
    city VARCHAR(100) NULL,
    credit_limit DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    available_credit DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uk_customers_company_nit (company_id, nit),
    KEY idx_customers_nit (nit),
    KEY idx_customers_name (name),
    KEY idx_customers_phone (phone),
    KEY idx_customers_status (status),

    CONSTRAINT fk_customers_company
        FOREIGN KEY (company_id)
        REFERENCES companies(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- FACTURAS
-- ============================================================

CREATE TABLE invoices (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    company_id BIGINT UNSIGNED NULL,
    customer_id BIGINT UNSIGNED NOT NULL,

    invoice_number VARCHAR(100) NOT NULL,
    issue_date DATE NULL,
    due_date DATE NULL,

    document_value DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    base_value DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    iva_value DECIMAL(15,2) NOT NULL DEFAULT 0.00,

    balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,

    credit_days INT NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'pending',

    promo_18 DECIMAL(15,2) NULL,
    discount DECIMAL(15,2) NULL,

    email VARCHAR(150) NULL,
    notes TEXT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,

    PRIMARY KEY (id),

    UNIQUE KEY uk_invoices_company_number (company_id, invoice_number),

    KEY idx_invoices_customer (customer_id),
    KEY idx_invoices_status (status),
    KEY idx_invoices_due_date (due_date),
    KEY idx_invoices_issue_date (issue_date),
    KEY idx_invoices_balance (balance),

    CONSTRAINT fk_invoices_company
        FOREIGN KEY (company_id)
        REFERENCES companies(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_invoices_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- PAGOS
-- Un pago puede aplicarse a una o varias facturas
-- ============================================================

CREATE TABLE payments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    company_id BIGINT UNSIGNED NULL,
    customer_id BIGINT UNSIGNED NOT NULL,

    payment_date DATE NOT NULL,
    amount DECIMAL(15,2) NOT NULL,

    payment_method VARCHAR(50) NULL,
    reference VARCHAR(150) NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'confirmed',

    notes TEXT NULL,

    created_by BIGINT UNSIGNED NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_payments_customer (customer_id),
    KEY idx_payments_date (payment_date),
    KEY idx_payments_status (status),
    KEY idx_payments_reference (reference),

    CONSTRAINT fk_payments_company
        FOREIGN KEY (company_id)
        REFERENCES companies(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_payments_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,

    CONSTRAINT fk_payments_created_by
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- APLICACIÓN DE PAGOS A FACTURAS
-- ============================================================

CREATE TABLE payment_allocations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    payment_id BIGINT UNSIGNED NOT NULL,
    invoice_id BIGINT UNSIGNED NOT NULL,
    amount DECIMAL(15,2) NOT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    UNIQUE KEY uk_payment_invoice (payment_id, invoice_id),

    KEY idx_allocations_invoice (invoice_id),

    CONSTRAINT fk_allocations_payment
        FOREIGN KEY (payment_id)
        REFERENCES payments(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_allocations_invoice
        FOREIGN KEY (invoice_id)
        REFERENCES invoices(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- GESTIONES DE COBRANZA
-- ============================================================

CREATE TABLE collection_actions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    company_id BIGINT UNSIGNED NULL,
    customer_id BIGINT UNSIGNED NOT NULL,
    invoice_id BIGINT UNSIGNED NULL,
    user_id BIGINT UNSIGNED NULL,

    action_type VARCHAR(50) NOT NULL,
    channel VARCHAR(50) NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'completed',

    subject VARCHAR(200) NULL,
    description TEXT NULL,

    action_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    next_action_date DATETIME NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_collection_customer (customer_id),
    KEY idx_collection_invoice (invoice_id),
    KEY idx_collection_user (user_id),
    KEY idx_collection_date (action_date),
    KEY idx_collection_type (action_type),
    KEY idx_collection_channel (channel),

    CONSTRAINT fk_collection_company
        FOREIGN KEY (company_id)
        REFERENCES companies(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_collection_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,

    CONSTRAINT fk_collection_invoice
        FOREIGN KEY (invoice_id)
        REFERENCES invoices(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_collection_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- PROMESAS DE PAGO
-- ============================================================

CREATE TABLE payment_promises (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    company_id BIGINT UNSIGNED NULL,
    customer_id BIGINT UNSIGNED NOT NULL,
    invoice_id BIGINT UNSIGNED NULL,
    created_by BIGINT UNSIGNED NULL,

    promised_date DATE NOT NULL,
    promised_amount DECIMAL(15,2) NOT NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'pending',

    fulfilled_at DATETIME NULL,

    notes TEXT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_promises_customer (customer_id),
    KEY idx_promises_invoice (invoice_id),
    KEY idx_promises_date (promised_date),
    KEY idx_promises_status (status),

    CONSTRAINT fk_promises_company
        FOREIGN KEY (company_id)
        REFERENCES companies(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_promises_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,

    CONSTRAINT fk_promises_invoice
        FOREIGN KEY (invoice_id)
        REFERENCES invoices(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_promises_created_by
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- PLANTILLAS DE MENSAJES
-- ============================================================

CREATE TABLE message_templates (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    company_id BIGINT UNSIGNED NULL,

    name VARCHAR(150) NOT NULL,
    channel VARCHAR(50) NOT NULL DEFAULT 'whatsapp',

    subject VARCHAR(200) NULL,
    content TEXT NOT NULL,

    stage VARCHAR(50) NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'active',

    created_by BIGINT UNSIGNED NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_templates_company (company_id),
    KEY idx_templates_channel (channel),
    KEY idx_templates_stage (stage),
    KEY idx_templates_status (status),

    CONSTRAINT fk_templates_company
        FOREIGN KEY (company_id)
        REFERENCES companies(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_templates_created_by
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- MENSAJES
-- Registro de mensajes enviados
-- Preparado para WhatsApp y otros canales
-- ============================================================

CREATE TABLE messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    company_id BIGINT UNSIGNED NULL,
    customer_id BIGINT UNSIGNED NOT NULL,
    invoice_id BIGINT UNSIGNED NULL,
    template_id BIGINT UNSIGNED NULL,
    created_by BIGINT UNSIGNED NULL,

    channel VARCHAR(50) NOT NULL,
    recipient VARCHAR(150) NULL,

    subject VARCHAR(200) NULL,
    content TEXT NOT NULL,

    status VARCHAR(50) NOT NULL DEFAULT 'pending',

    provider VARCHAR(100) NULL,
    provider_message_id VARCHAR(200) NULL,

    sent_at DATETIME NULL,
    delivered_at DATETIME NULL,
    read_at DATETIME NULL,

    error_code VARCHAR(100) NULL,
    error_message TEXT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_messages_customer (customer_id),
    KEY idx_messages_invoice (invoice_id),
    KEY idx_messages_template (template_id),
    KEY idx_messages_status (status),
    KEY idx_messages_channel (channel),
    KEY idx_messages_provider_id (provider_message_id),
    KEY idx_messages_created_at (created_at),

    CONSTRAINT fk_messages_company
        FOREIGN KEY (company_id)
        REFERENCES companies(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_messages_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,

    CONSTRAINT fk_messages_invoice
        FOREIGN KEY (invoice_id)
        REFERENCES invoices(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_messages_template
        FOREIGN KEY (template_id)
        REFERENCES message_templates(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_messages_created_by
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- LOTES DE IMPORTACIÓN DE CARTERA
-- ============================================================

CREATE TABLE import_batches (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    company_id BIGINT UNSIGNED NULL,
    user_id BIGINT UNSIGNED NULL,

    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(50) NULL,

    total_rows INT UNSIGNED NOT NULL DEFAULT 0,
    processed_rows INT UNSIGNED NOT NULL DEFAULT 0,
    successful_rows INT UNSIGNED NOT NULL DEFAULT 0,
    failed_rows INT UNSIGNED NOT NULL DEFAULT 0,

    status VARCHAR(30) NOT NULL DEFAULT 'pending',

    started_at DATETIME NULL,
    completed_at DATETIME NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_import_company (company_id),
    KEY idx_import_user (user_id),
    KEY idx_import_status (status),
    KEY idx_import_created_at (created_at),

    CONSTRAINT fk_import_company
        FOREIGN KEY (company_id)
        REFERENCES companies(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_import_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- ERRORES DE IMPORTACIÓN
-- ============================================================

CREATE TABLE import_errors (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    import_batch_id BIGINT UNSIGNED NOT NULL,

    row_number INT UNSIGNED NULL,
    field_name VARCHAR(100) NULL,
    field_value TEXT NULL,
    error_message TEXT NOT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_import_errors_batch (import_batch_id),
    KEY idx_import_errors_row (row_number),

    CONSTRAINT fk_import_errors_batch
        FOREIGN KEY (import_batch_id)
        REFERENCES import_batches(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- CONFIGURACIÓN DEL SISTEMA
-- ============================================================

CREATE TABLE settings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    company_id BIGINT UNSIGNED NULL,

    setting_key VARCHAR(150) NOT NULL,
    setting_value TEXT NULL,
    value_type VARCHAR(30) NOT NULL DEFAULT 'string',

    description VARCHAR(255) NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    UNIQUE KEY uk_settings_company_key (company_id, setting_key),

    CONSTRAINT fk_settings_company
        FOREIGN KEY (company_id)
        REFERENCES companies(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- AUDITORÍA
-- Registro de cambios importantes del sistema
-- ============================================================

CREATE TABLE audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    company_id BIGINT UNSIGNED NULL,
    user_id BIGINT UNSIGNED NULL,

    entity_type VARCHAR(100) NOT NULL,
    entity_id BIGINT UNSIGNED NULL,

    action VARCHAR(50) NOT NULL,

    old_values JSON NULL,
    new_values JSON NULL,

    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(500) NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    KEY idx_audit_company (company_id),
    KEY idx_audit_user (user_id),
    KEY idx_audit_entity (entity_type, entity_id),
    KEY idx_audit_action (action),
    KEY idx_audit_created_at (created_at),

    CONSTRAINT fk_audit_company
        FOREIGN KEY (company_id)
        REFERENCES companies(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_audit_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- DATOS INICIALES
-- ============================================================

INSERT INTO roles (name, description)
VALUES
    ('admin', 'Administrador del sistema'),
    ('collector', 'Gestor de cartera y cobranza'),
    ('supervisor', 'Supervisor de cartera');


-- ============================================================
-- CONFIGURACIÓN BASE
-- ============================================================

INSERT INTO settings (
    company_id,
    setting_key,
    setting_value,
    value_type,
    description
)
VALUES
    (NULL, 'iva_percentage', '19', 'number', 'Porcentaje de IVA'),
    (NULL, 'prompt_payment_discount', '3', 'number', 'Descuento por pronto pago'),
    (NULL, 'business_day_due_day', '7', 'number', 'Día hábil de referencia'),
    (NULL, 'payment_cutoff_day', '10', 'number', 'Día límite de pago'),
    (NULL, 'reminder_days_before_due', '5', 'number', 'Días antes del vencimiento para recordatorio'),
    (NULL, 'reminder_days_after_due', '1', 'number', 'Días después del vencimiento para mora'),
    (NULL, 'daily_message_limit', '250', 'number', 'Límite diario de mensajes'),
    (NULL, 'contact_line', '', 'string', 'Línea principal de contacto');


SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- FIN DE MIGRACIÓN 001
-- ============================================================