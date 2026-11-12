CREATE INDEX IF NOT EXISTS paiements_bi_idx ON paiements (school_id, annee_scolaire, date_paiement) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS absences_bi_idx  ON absences  (school_id, annee_scolaire, date_absence);
CREATE INDEX IF NOT EXISTS notes_eval_idx   ON notes     (school_id, evaluation_id);