-- NEXORA v1 initial schema: logical schemas per module.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS intelligence;
CREATE SCHEMA IF NOT EXISTS mobility;
CREATE SCHEMA IF NOT EXISTS health;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS work;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS notifications;

-- identity ----------------------------------------------------------------
CREATE TABLE identity.users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         citext UNIQUE,
    phone         text UNIQUE,
    auth_provider text NOT NULL DEFAULT 'password',
    status        text NOT NULL DEFAULT 'active',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.user_sessions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- platform ------------------------------------------------------------------
CREATE TABLE platform.profiles (
    user_id      uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
    display_name text,
    locale       text NOT NULL DEFAULT 'en-IN',
    timezone     text NOT NULL DEFAULT 'Asia/Kolkata',
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.module_preferences (
    id         bigserial PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    module_key text NOT NULL CHECK (module_key IN ('move','health','finance','work')),
    enabled    boolean NOT NULL DEFAULT false,
    UNIQUE (user_id, module_key)
);

CREATE TABLE platform.permissions (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id  uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    resource text NOT NULL,
    action   text NOT NULL,
    granted  boolean NOT NULL DEFAULT false,
    UNIQUE (user_id, resource, action)
);

CREATE TABLE platform.consent_records (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    purpose    text NOT NULL,
    scope      text NOT NULL,
    granted_at timestamptz,
    revoked_at timestamptz
);

CREATE TABLE platform.integrations (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    provider   text NOT NULL,
    status     text NOT NULL DEFAULT 'disconnected',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.integration_tokens (
    integration_id       uuid PRIMARY KEY REFERENCES platform.integrations(id) ON DELETE CASCADE,
    encrypted_secret_ref text NOT NULL
);

-- notifications -------------------------------------------------------------
CREATE TABLE notifications.notifications (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    type       text NOT NULL,
    payload    jsonb NOT NULL DEFAULT '{}',
    read_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- audit ---------------------------------------------------------------------
CREATE TABLE audit.access_log (
    id            bigserial PRIMARY KEY,
    actor_id      uuid,
    resource_type text NOT NULL,
    resource_id   text,
    action        text NOT NULL,
    occurred_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit.agent_action_log (
    id            bigserial PRIMARY KEY,
    agent_run_id  uuid,
    tool          text NOT NULL,
    approval_id   uuid,
    result        text,
    occurred_at   timestamptz NOT NULL DEFAULT now()
);
