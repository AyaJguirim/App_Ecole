const express = require("express");
const { auth, allow, h } = require("../auth");
const router = express.Router();

// Une seule route : chaque rôle ne reçoit QUE ses indicateurs
router.get(
  "/bi",
  auth,
  allow("admin", "comptable", "superadmin"),
  h(async (req, res, db) => {
    const u = req.user,
      A = u.school?.annee_courante;
    if (u.role === "superadmin") return plateforme(db);
    return u.role === "comptable" ? finance(db, A) : direction(db, A);
  }),
);

const N20 = "n.valeur / ev.bareme * 20"; // note ramenée sur 20

// ── Direction : pédagogie et effectifs, JAMAIS de montant ──
async function direction(db, A) {
  const S = db.sid,
    q = (sql) => db.q(sql, [S, A]);
  const kpis = await db.one(
    `SELECT
    (SELECT count(*)::int FROM eleves WHERE school_id=$1 AND deleted_at IS NULL AND statut='inscrit') eleves,
    (SELECT COALESCE(sum(capacite),0)::int FROM classes WHERE school_id=$1 AND deleted_at IS NULL AND annee_scolaire=$2) capacite,
    (SELECT count(*)::int FROM absences WHERE school_id=$1 AND annee_scolaire=$2) abs_total,
    (SELECT count(*)::int FROM absences WHERE school_id=$1 AND annee_scolaire=$2 AND NOT justifiee) abs_non_just,
    (SELECT round(avg(${N20}),2)::float8 FROM notes n JOIN evaluations ev ON ev.id=n.evaluation_id AND ev.school_id=n.school_id
       WHERE n.school_id=$1 AND ev.annee_scolaire=$2 AND ev.deleted_at IS NULL) moyenne`,
    [S, A],
  );
  return {
    role: "admin",
    annee: A,
    kpis,
    effectifs:
      await q(`SELECT c.niveau||'ère/ème '||c.section AS classe, count(e.id)::int effectif, c.capacite
      FROM classes c LEFT JOIN eleves e ON e.classe_id=c.id AND e.deleted_at IS NULL AND e.statut='inscrit'
      WHERE c.school_id=$1 AND c.deleted_at IS NULL AND c.annee_scolaire=$2 GROUP BY c.id ORDER BY c.niveau,c.section`),
    sexe: await q(
      `SELECT sexe, count(*)::int n FROM eleves WHERE school_id=$1 AND deleted_at IS NULL AND statut='inscrit' AND $2=$2 GROUP BY sexe`,
    ),
    matieres:
      await q(`SELECT m.nom matiere, round(avg(${N20}),2)::float8 moyenne
      FROM notes n JOIN evaluations ev ON ev.id=n.evaluation_id AND ev.school_id=n.school_id
      JOIN matieres m ON m.id=ev.matiere_id AND m.school_id=ev.school_id
      WHERE n.school_id=$1 AND ev.annee_scolaire=$2 AND ev.deleted_at IS NULL GROUP BY m.nom ORDER BY moyenne`),
    trimestres:
      await q(`SELECT ev.trimestre, round(avg(${N20}),2)::float8 moyenne
      FROM notes n JOIN evaluations ev ON ev.id=n.evaluation_id AND ev.school_id=n.school_id
      WHERE n.school_id=$1 AND ev.annee_scolaire=$2 AND ev.deleted_at IS NULL GROUP BY ev.trimestre ORDER BY 1`),
    absences_mensuelles:
      await q(`SELECT to_char(date_absence,'YYYY-MM') mois, count(*)::int n
      FROM absences WHERE school_id=$1 AND annee_scolaire=$2 GROUP BY 1 ORDER BY 1`),
    preinscriptions:
      await q(`SELECT to_char(created_at,'YYYY-MM') mois, count(*)::int n
      FROM preinscriptions WHERE school_id=$1 AND $2=$2 AND created_at > now() - interval '12 months' GROUP BY 1 ORDER BY 1`),
    en_difficulte:
      await q(`SELECT e.id, e.nom, e.prenom, c.niveau, c.section, round(avg(${N20}),2)::float8 moyenne
      FROM notes n JOIN evaluations ev ON ev.id=n.evaluation_id AND ev.school_id=n.school_id
      JOIN eleves e ON e.id=n.eleve_id AND e.school_id=n.school_id AND e.deleted_at IS NULL
      LEFT JOIN classes c ON c.id=e.classe_id
      WHERE n.school_id=$1 AND ev.annee_scolaire=$2 AND ev.deleted_at IS NULL
      GROUP BY e.id,c.niveau,c.section HAVING avg(${N20}) < 10 ORDER BY moyenne LIMIT 10`),
  };
}

// ── Comptable : finance uniquement ──
async function finance(db, A) {
  const S = db.sid,
    q = (sql) => db.q(sql, [S, A]);
  const P = "school_id=$1 AND annee_scolaire=$2 AND deleted_at IS NULL";
  const kpis = await db.one(
    `SELECT
    (SELECT COALESCE(sum(montant),0)::float8 FROM paiements WHERE ${P}) encaisse,
    (SELECT COALESCE(sum(montant),0) FROM tarifs WHERE school_id=$1 AND annee_scolaire=$2)::float8
      * (SELECT count(*) FROM eleves WHERE school_id=$1 AND deleted_at IS NULL AND statut='inscrit') du,
    (SELECT count(*)::int FROM paiements WHERE ${P}) nb_paiements`,
    [S, A],
  );
  return {
    role: "comptable",
    annee: A,
    kpis,
    mensuel: await q(
      `SELECT to_char(date_paiement,'YYYY-MM') mois, sum(montant)::float8 total FROM paiements WHERE ${P} GROUP BY 1 ORDER BY 1`,
    ),
    modes: await q(
      `SELECT mode, sum(montant)::float8 total FROM paiements WHERE ${P} GROUP BY mode ORDER BY 2 DESC`,
    ),
    libelles: await q(
      `SELECT libelle, sum(montant)::float8 total FROM paiements WHERE ${P} GROUP BY libelle ORDER BY 2 DESC`,
    ),
    niveaux:
      await q(`WITH du AS (SELECT COALESCE(sum(montant),0) v FROM tarifs WHERE school_id=$1 AND annee_scolaire=$2)
      SELECT c.niveau, count(e.id)::int eleves, ((SELECT v FROM du) * count(e.id))::float8 du,
        COALESCE((SELECT sum(p.montant) FROM paiements p
          JOIN eleves e2 ON e2.id=p.eleve_id AND e2.school_id=p.school_id
          JOIN classes c2 ON c2.id=e2.classe_id AND c2.school_id=p.school_id AND c2.annee_scolaire=$2
          WHERE p.school_id=$1 AND p.annee_scolaire=$2 AND p.deleted_at IS NULL AND c2.niveau=c.niveau),0)::float8 paye
      FROM classes c JOIN eleves e ON e.classe_id=c.id AND e.deleted_at IS NULL AND e.statut='inscrit'
      WHERE c.school_id=$1 AND c.annee_scolaire=$2 AND c.deleted_at IS NULL GROUP BY c.niveau ORDER BY c.niveau`),
  };
}

// ── Super-admin : la plateforme (toutes écoles) ──
async function plateforme(db) {
  return {
    role: "superadmin",
    statuts: await db.q(
      `SELECT status, count(*)::int n FROM schools GROUP BY status`,
    ),
    formules: await db.q(
      `SELECT plan, count(*)::int n FROM schools GROUP BY plan`,
    ),
    croissance: await db.q(
      `SELECT to_char(created_at,'YYYY-MM') mois, count(*)::int n FROM schools GROUP BY 1 ORDER BY 1`,
    ),
    expirent: await db.q(`SELECT id, name, subscription_end FROM schools
      WHERE subscription_end IS NOT NULL AND subscription_end < CURRENT_DATE + 30 ORDER BY subscription_end`),
    par_ecole: await db.q(`SELECT s.name,
      (SELECT count(*)::int FROM eleves e WHERE e.school_id=s.id AND e.deleted_at IS NULL) eleves,
      (SELECT COALESCE(sum(montant),0)::float8 FROM paiements p WHERE p.school_id=s.id AND p.deleted_at IS NULL) encaisse
      FROM schools s ORDER BY eleves DESC`),
  };
}
module.exports = router;
