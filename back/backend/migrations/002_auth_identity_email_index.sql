-- Google and magic-link identities may share an email address. Provider and
-- provider_subject remain the identity key; email is only a linking hint.
DROP INDEX IF EXISTS auth_identities_active_email_unique;
CREATE INDEX IF NOT EXISTS auth_identities_email_idx
    ON auth_identities (lower(email))
    WHERE email IS NOT NULL AND revoked_at IS NULL;
