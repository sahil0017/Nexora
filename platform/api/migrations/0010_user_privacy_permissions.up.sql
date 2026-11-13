-- User privacy & OS permission state + immutable consent audit trail
CREATE TABLE IF NOT EXISTS user_privacy_permissions (
    user_id TEXT NOT NULL,
    permission_key TEXT NOT NULL,
    domain TEXT NOT NULL DEFAULT 'General',
    granted BOOLEAN NOT NULL DEFAULT FALSE,
    os_status TEXT NOT NULL DEFAULT 'unknown',
    source TEXT NOT NULL DEFAULT 'mobile_app',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_user_privacy_permissions_user
    ON user_privacy_permissions (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS user_privacy_consent_audit (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    permission_key TEXT NOT NULL,
    granted BOOLEAN NOT NULL,
    source TEXT NOT NULL DEFAULT 'mobile_app',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_privacy_consent_audit_user
    ON user_privacy_consent_audit (user_id, created_at DESC);
