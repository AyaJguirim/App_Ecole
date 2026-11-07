BEGIN;
CREATE TABLE IF NOT EXISTS password_resets (
  id SERIAL PRIMARY KEY,
  email VARCHAR(200) NOT NULL,
  code_hash VARCHAR(100) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_email_idx ON password_resets (email);
GRANT SELECT, INSERT, UPDATE, DELETE ON password_resets TO app_user;
GRANT USAGE, SELECT ON SEQUENCE password_resets_id_seq TO app_user;
COMMIT;