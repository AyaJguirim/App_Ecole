-- =====================================================================
-- Schéma PostgreSQL : application de gestion d'écoles primaires (multi-écoles)
-- Règle d'or : chaque donnée appartient à une école (school_id).
-- Seconde barrière : Row Level Security (RLS) sur toutes les tables.
-- =====================================================================
CREATE TABLE schools (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','suspended')),
  plan VARCHAR(20) NOT NULL DEFAULT 'basic' CHECK (plan IN ('basic','standard','premium')),
  subscription_end DATE,
  annee_courante VARCHAR(9) NOT NULL DEFAULT '2026-2027' CHECK (annee_courante ~ '^[0-9]{4}-[0-9]{4}$'),
  adresse VARCHAR(255), telephone VARCHAR(30), email VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  school_id INT REFERENCES schools(id),
  email VARCHAR(200) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('superadmin','admin','comptable','enseignant','parent','eleve')),
  nom VARCHAR(60) NOT NULL, prenom VARCHAR(60) NOT NULL,
  telephone VARCHAR(30),
  actif BOOLEAN NOT NULL DEFAULT true,
  mdp_temporaire BOOLEAN NOT NULL DEFAULT false,   -- mot de passe généré : à changer à la 1ère connexion
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((role = 'superadmin') = (school_id IS NULL))
);
-- e-mail unique PAR école (un parent ayant des enfants dans 2 écoles a un compte dans chacune) ; super-admins uniques globalement
CREATE UNIQUE INDEX users_email_school_uq ON users (school_id, lower(email)) WHERE school_id IS NOT NULL;
CREATE UNIQUE INDEX users_email_super_uq ON users (lower(email)) WHERE school_id IS NULL;
CREATE INDEX users_school_idx ON users (school_id, role);

CREATE TABLE classes (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  niveau INT NOT NULL CHECK (niveau BETWEEN 1 AND 6),
  section VARCHAR(3) NOT NULL, capacite INT NOT NULL CHECK (capacite BETWEEN 5 AND 40),
  annee_scolaire VARCHAR(9) NOT NULL, enseignant_id INT REFERENCES users(id),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX classes_uq ON classes (school_id, annee_scolaire, niveau, section) WHERE deleted_at IS NULL;

CREATE TABLE matieres (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  nom VARCHAR(80) NOT NULL, coefficient NUMERIC(4,1) NOT NULL CHECK (coefficient BETWEEN 0.5 AND 10),
  niveau INT CHECK (niveau BETWEEN 1 AND 6), deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX matieres_uq ON matieres (school_id, lower(nom), COALESCE(niveau,0)) WHERE deleted_at IS NULL;

CREATE TABLE salles (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  nom VARCHAR(60) NOT NULL, capacite INT NOT NULL CHECK (capacite BETWEEN 1 AND 100),
  disponible BOOLEAN NOT NULL DEFAULT true, deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX salles_uq ON salles (school_id, lower(nom)) WHERE deleted_at IS NULL;

CREATE TABLE affectations (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  enseignant_id INT NOT NULL REFERENCES users(id),
  matiere_id INT NOT NULL REFERENCES matieres(id),
  classe_id INT NOT NULL REFERENCES classes(id),
  UNIQUE (school_id, enseignant_id, matiere_id, classe_id)
);

CREATE TABLE fichiers (
  id UUID PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  nom VARCHAR(200) NOT NULL, chemin VARCHAR(300) NOT NULL, mime VARCHAR(100) NOT NULL, taille INT NOT NULL,
  contexte VARCHAR(20) NOT NULL, ref_id INT, uploaded_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE eleves (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  matricule VARCHAR(20) NOT NULL,
  nom VARCHAR(60) NOT NULL, prenom VARCHAR(60) NOT NULL,
  date_naissance DATE NOT NULL, sexe CHAR(1) NOT NULL CHECK (sexe IN ('M','F')),
  adresse VARCHAR(255), antecedents_medicaux TEXT,
  annee_entree INT NOT NULL,
  statut VARCHAR(12) NOT NULL DEFAULT 'inscrit' CHECK (statut IN ('preinscrit','inscrit')),
  classe_id INT REFERENCES classes(id),
  parent_id INT REFERENCES users(id), user_id INT REFERENCES users(id),
  photo_id UUID REFERENCES fichiers(id), derniere_relance DATE, deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX eleves_matricule_uq ON eleves (school_id, matricule) WHERE deleted_at IS NULL;  -- unique PAR école
CREATE INDEX eleves_idx ON eleves (school_id, classe_id);

CREATE TABLE creneaux (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  classe_id INT NOT NULL REFERENCES classes(id), matiere_id INT NOT NULL REFERENCES matieres(id),
  enseignant_id INT NOT NULL REFERENCES users(id), salle_id INT REFERENCES salles(id),
  jour INT NOT NULL CHECK (jour BETWEEN 1 AND 6), debut TIME NOT NULL, fin TIME NOT NULL,
  CHECK (fin > debut)
);

CREATE TABLE evaluations (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  classe_id INT NOT NULL REFERENCES classes(id), matiere_id INT NOT NULL REFERENCES matieres(id),
  titre VARCHAR(120) NOT NULL, type VARCHAR(20) NOT NULL CHECK (type IN ('controle','devoir_surveille','examen')),
  trimestre INT NOT NULL CHECK (trimestre BETWEEN 1 AND 3), date_eval DATE NOT NULL,
  bareme NUMERIC(5,1) NOT NULL DEFAULT 20 CHECK (bareme BETWEEN 1 AND 100),
  annee_scolaire VARCHAR(9) NOT NULL, deleted_at TIMESTAMPTZ
);

CREATE TABLE notes (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  evaluation_id INT NOT NULL REFERENCES evaluations(id), eleve_id INT NOT NULL REFERENCES eleves(id),
  valeur NUMERIC(5,2) NOT NULL CHECK (valeur >= 0), commentaire VARCHAR(255),
  UNIQUE (evaluation_id, eleve_id)
);

CREATE TABLE absences (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  eleve_id INT NOT NULL REFERENCES eleves(id), date_absence DATE NOT NULL,
  periode VARCHAR(12) NOT NULL DEFAULT 'journee' CHECK (periode IN ('matin','apres_midi','journee')),
  motif VARCHAR(255), justifiee BOOLEAN NOT NULL DEFAULT false, justification VARCHAR(500),
  annee_scolaire VARCHAR(9) NOT NULL,
  UNIQUE (school_id, eleve_id, date_absence, periode)
);

CREATE TABLE preinscriptions (   -- demandes déposées par les familles (sans compte), validées par la direction
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  statut VARCHAR(12) NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','validee','refusee')),
  parent_nom VARCHAR(60) NOT NULL, parent_prenom VARCHAR(60) NOT NULL, parent_email VARCHAR(200) NOT NULL, parent_telephone VARCHAR(30) NOT NULL,
  enfant_nom VARCHAR(60) NOT NULL, enfant_prenom VARCHAR(60) NOT NULL, date_naissance DATE NOT NULL, sexe CHAR(1) NOT NULL CHECK (sexe IN ('M','F')),
  adresse VARCHAR(255), antecedents_medicaux TEXT, consentement_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  motif_refus VARCHAR(300), eleve_id INT REFERENCES eleves(id), traite_par INT REFERENCES users(id), traite_le TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX preinscriptions_idx ON preinscriptions (school_id, statut);

CREATE TABLE tarifs (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  annee_scolaire VARCHAR(9) NOT NULL, libelle VARCHAR(100) NOT NULL,
  montant NUMERIC(10,2) NOT NULL CHECK (montant > 0),
  UNIQUE (school_id, annee_scolaire, libelle)
);

CREATE TABLE paiements (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  eleve_id INT NOT NULL REFERENCES eleves(id), annee_scolaire VARCHAR(9) NOT NULL,
  montant NUMERIC(10,2) NOT NULL CHECK (montant > 0), date_paiement DATE NOT NULL,
  mode VARCHAR(20) NOT NULL CHECK (mode IN ('especes','virement','mobile_money')),
  libelle VARCHAR(100) NOT NULL DEFAULT 'Scolarité', reference VARCHAR(60),
  numero_recu VARCHAR(30) NOT NULL, saisi_par INT REFERENCES users(id), deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX paiements_recu_uq ON paiements (school_id, numero_recu);  -- n° de reçu unique PAR école

CREATE TABLE devoirs (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  classe_id INT NOT NULL REFERENCES classes(id), matiere_id INT NOT NULL REFERENCES matieres(id),
  enseignant_id INT NOT NULL REFERENCES users(id),
  titre VARCHAR(150) NOT NULL, description TEXT, date_remise DATE NOT NULL,
  bareme NUMERIC(5,1) NOT NULL DEFAULT 20 CHECK (bareme BETWEEN 1 AND 100),
  pieces JSONB NOT NULL DEFAULT '[]', correction_id UUID REFERENCES fichiers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);

CREATE TABLE depots (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  devoir_id INT NOT NULL REFERENCES devoirs(id), eleve_id INT NOT NULL REFERENCES eleves(id),
  fichiers JSONB NOT NULL DEFAULT '[]', date_depot TIMESTAMPTZ NOT NULL DEFAULT now(),
  note NUMERIC(5,2) CHECK (note >= 0), commentaire VARCHAR(500), vu_parent BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (devoir_id, eleve_id)
);

CREATE TABLE messages (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  expediteur_id INT NOT NULL REFERENCES users(id),
  type VARCHAR(10) NOT NULL DEFAULT 'message' CHECK (type IN ('message','annonce')),
  objet VARCHAR(150) NOT NULL, corps TEXT NOT NULL, pieces JSONB NOT NULL DEFAULT '[]',
  statut VARCHAR(10) NOT NULL DEFAULT 'envoye' CHECK (statut IN ('brouillon','envoye')),
  cible VARCHAR(12) CHECK (cible IN ('tous','parents','enseignants','eleves')),
  eleve_id INT REFERENCES eleves(id), lien VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ
);
CREATE TABLE message_destinataires (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  message_id INT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  destinataire_id INT NOT NULL REFERENCES users(id),
  lu BOOLEAN NOT NULL DEFAULT false, masque BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (message_id, destinataire_id)
);

CREATE TABLE notifications (
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  user_id INT NOT NULL REFERENCES users(id), titre VARCHAR(150) NOT NULL, texte VARCHAR(500),
  lien VARCHAR(200), lu BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notif_idx ON notifications (user_id, lu);

CREATE TABLE envois_log (   -- journal d'envoi des messages / e-mails / push
  id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  destinataire_id INT REFERENCES users(id), canal VARCHAR(20) NOT NULL, sujet VARCHAR(150),
  statut VARCHAR(30) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE journal (      -- journal d'actions (audit)
  id BIGSERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
  user_id INT REFERENCES users(id), action VARCHAR(30) NOT NULL, entite VARCHAR(30) NOT NULL, entite_id INT,
  anciennes JSONB, nouvelles JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX journal_idx ON journal (school_id, created_at DESC);

CREATE INDEX ON classes(school_id); CREATE INDEX ON matieres(school_id); CREATE INDEX ON salles(school_id);
CREATE INDEX ON affectations(school_id); CREATE INDEX ON creneaux(school_id); CREATE INDEX ON evaluations(school_id);
CREATE INDEX ON notes(school_id); CREATE INDEX ON absences(school_id); CREATE INDEX ON tarifs(school_id);
CREATE INDEX ON paiements(school_id); CREATE INDEX ON fichiers(school_id); CREATE INDEX ON devoirs(school_id);
CREATE INDEX ON depots(school_id); CREATE INDEX ON messages(school_id); CREATE INDEX ON message_destinataires(school_id);
CREATE INDEX ON envois_log(school_id);

-- ---------------------------------------------------------------------
-- Row Level Security : 2e barrière côté base de données.
-- Le backend se connecte avec un rôle non propriétaire (app_user) et fixe
-- app.school_id au début de chaque transaction.
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'school_id' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (current_setting('app.bypass', true) = 'on' OR school_id = NULLIF(current_setting('app.school_id', true), '')::int)
      WITH CHECK (current_setting('app.bypass', true) = 'on' OR school_id = NULLIF(current_setting('app.school_id', true), '')::int)$p$, t);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS paiements_bi_idx ON paiements (school_id, annee_scolaire, date_paiement) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS absences_bi_idx  ON absences  (school_id, annee_scolaire, date_absence);
CREATE INDEX IF NOT EXISTS notes_eval_idx   ON notes     (school_id, evaluation_id);
