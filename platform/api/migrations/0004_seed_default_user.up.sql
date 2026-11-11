-- Seed dedicated test user (Sahil Kanungo) for development & mobile testing
-- prior to Google / Apple (iOS) OIDC authentication cutover.
INSERT INTO identity.users (id, email, password_hash, auth_provider, status)
VALUES ('00000000-0000-0000-0000-000000000000', 'sahil.kanungo@nexora.ai', '', 'local', 'active')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  status = 'active';

INSERT INTO platform.profiles (user_id, display_name, locale, timezone)
VALUES ('00000000-0000-0000-0000-000000000000', 'Sahil Kanungo', 'en-IN', 'Asia/Kolkata')
ON CONFLICT (user_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  locale = EXCLUDED.locale,
  timezone = EXCLUDED.timezone;

INSERT INTO platform.module_preferences (user_id, module_key, enabled)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'move', true),
  ('00000000-0000-0000-0000-000000000000', 'health', true),
  ('00000000-0000-0000-0000-000000000000', 'finance', true),
  ('00000000-0000-0000-0000-000000000000', 'work', true),
  ('00000000-0000-0000-0000-000000000000', 'assistant', true)
ON CONFLICT (user_id, module_key) DO UPDATE SET enabled = EXCLUDED.enabled;
