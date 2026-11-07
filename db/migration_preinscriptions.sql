-- Migration (base DÉJÀ créée avec une version antérieure) : pré-inscriptions publiques + comptes automatiques.
-- À exécuter une seule fois :  Get-Content db\migration_preinscriptions.sql | docker compose exec -T db psql -U ecole_admin -d ecole
-- (sur une base neuve, ce fichier est inutile : db/01-schema.sql contient déjà tout)
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mdp_temporaire BOOLEAN NOT NULL DEFAULT false;
DROP INDEX IF EXISTS users_email_uq;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_school_uq ON users (school_id, lower(email)) WHERE school_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_super_uq ON users (lower(email)) WHERE school_id IS NULL;
CREATE TABLE IF NOT EXISTS preinscriptions (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  statut VARCHAR(12) NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','validee','refusee')),
  parent_nom VARCHAR(60) NOT NULL, parent_prenom VARCHAR(60) NOT NULL, parent_email VARCHAR(200) NOT NULL, parent_telephone VARCHAR(30) NOT NULL,
  enfant_nom VARCHAR(60) NOT NULL, enfant_prenom VARCHAR(60) NOT NULL, date_naissance DATE NOT NULL, sexe CHAR(1) NOT NULL CHECK (sexe IN ('M','F')),
  adresse VARCHAR(255), antecedents_medicaux TEXT, consentement_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  motif_refus VARCHAR(300), eleve_id INT REFERENCES eleves(id), traite_par INT REFERENCES users(id), traite_le TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS preinscriptions_idx ON preinscriptions (school_id, statut);
ALTER TABLE preinscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON preinscriptions;
CREATE POLICY tenant_isolation ON preinscriptions
  USING (current_setting('app.bypass', true) = 'on' OR school_id = NULLIF(current_setting('app.school_id', true), '')::int)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR school_id = NULLIF(current_setting('app.school_id', true), '')::int);
GRANT SELECT, INSERT, UPDATE, DELETE ON preinscriptions TO app_user;
GRANT USAGE, SELECT ON SEQUENCE preinscriptions_id_seq TO app_user;
COMMIT;
