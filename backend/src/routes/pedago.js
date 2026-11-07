const express = require("express");
const { HttpError, audit } = require("../db");
const { auth, allow, h } = require("../auth");
const { check, startYear, today } = require("../validate");
const {
  classScope,
  eleveScope,
  canSeeEleve,
  mustSeeEleve,
  teachesClass,
  classLabel,
} = require("../access");
const crud = require("../crud");
const pdf = require("../pdf");
const router = express.Router();
const MIN = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);

// ───────────── Emploi du temps ─────────────
crud(router, "creneaux", {
  table: "creneaux",
  read: ["admin", "enseignant", "parent", "eleve"],
  write: ["admin"],
  filters: ["classe_id", "enseignant_id"],
  order: "x.jour, x.debut",
  scope: (req, db) => classScope(req, db),
  cols: `x.id,x.classe_id,x.matiere_id,x.enseignant_id,x.salle_id,x.jour,to_char(x.debut,'HH24:MI') AS debut,to_char(x.fin,'HH24:MI') AS fin,
    (SELECT niveau FROM classes c WHERE c.id=x.classe_id) AS classe_niveau,(SELECT section FROM classes c WHERE c.id=x.classe_id) AS classe_section,
    (SELECT nom FROM matieres m WHERE m.id=x.matiere_id) AS matiere,(SELECT nom||' '||prenom FROM users u WHERE u.id=x.enseignant_id) AS enseignant,
    (SELECT nom FROM salles s WHERE s.id=x.salle_id) AS salle`,
  schema: {
    classe_id: { type: "ref", table: "classes", req: true, label: "Classe" },
    matiere_id: { type: "ref", table: "matieres", req: true, label: "Matière" },
    enseignant_id: {
      type: "ref",
      table: "users",
      role: "enseignant",
      req: true,
      label: "Enseignant",
    },
    salle_id: { type: "ref", table: "salles", label: "Salle" },
    jour: {
      type: "int",
      min: 1,
      max: 6,
      req: true,
      label: "Jour (1=lundi … 6=samedi)",
    },
    debut: { type: "time", req: true, label: "Début" },
    fin: { type: "time", req: true, label: "Fin" },
  },
  async before(db, d, req, old) {
    if (MIN(d.fin) <= MIN(d.debut))
      throw new HttpError(
        400,
        "L'heure de fin doit être postérieure à l'heure de début",
      );
    if (MIN(d.debut) < 450 || MIN(d.fin) > 1080)
      throw new HttpError(400, "Les cours ont lieu entre 07:30 et 18:00");
    if (MIN(d.fin) - MIN(d.debut) < 15)
      throw new HttpError(400, "Durée minimale d'un cours : 15 minutes");
    if (!(await teachesClass(db, d.enseignant_id, d.classe_id, d.matiere_id)))
      throw new HttpError(
        400,
        "Cet enseignant n'est pas affecté à cette matière dans cette classe (voir Affectations)",
      );
    const self = old?.id || 0;
    const annee = (await db.find("classes", d.classe_id)).annee_scolaire; // on ne compare qu'aux cours de la même année
    const conf = async (col, val, label) => {
      const c = await db.one(
        `SELECT to_char(x.debut,'HH24:MI') d, to_char(x.fin,'HH24:MI') f, cl.niveau, cl.section,
      (SELECT nom FROM matieres m WHERE m.id=x.matiere_id) matiere, (SELECT nom||' '||prenom FROM users u WHERE u.id=x.enseignant_id) ens
    FROM creneaux x JOIN classes cl ON cl.id=x.classe_id
    WHERE x.school_id=$1 AND x.${col}=$2 AND x.jour=$3 AND x.id<>$4 AND x.debut < $6::time AND x.fin > $5::time AND cl.annee_scolaire=$7 LIMIT 1`,
        [db.sid, val, d.jour, self, d.debut, d.fin, annee],
      );
      if (c)
        throw new HttpError(
          409,
          `Conflit : ${label} déjà occupé(e) de ${c.d} à ${c.f} (${c.matiere}, classe ${c.niveau}${c.section}, ${c.ens})`,
        );
    };
    await conf("enseignant_id", d.enseignant_id, "l'enseignant est");
    await conf("classe_id", d.classe_id, "la classe est");
    if (d.salle_id) {
      const s = await db.find("salles", d.salle_id);
      if (!s.disponible)
        throw new HttpError(400, "Cette salle est indisponible");
      const eff = (
        await db.one(
          "SELECT count(*)::int n FROM eleves WHERE classe_id=$1 AND school_id=$2 AND deleted_at IS NULL",
          [d.classe_id, db.sid],
        )
      ).n;
      if (eff > s.capacite)
        throw new HttpError(
          400,
          `Salle trop petite (${s.capacite} places pour ${eff} élèves)`,
        );
      await conf("salle_id", d.salle_id, "la salle est");
    }
  },
});

// ───────────── Évaluations ─────────────
const schoolYearRange = (annee) => [
  `${startYear(annee)}-08-15`,
  `${startYear(annee) + 1}-08-31`,
];
crud(router, "evaluations", {
  table: "evaluations",
  read: ["admin", "enseignant"],
  write: ["admin", "enseignant"],
  filters: ["classe_id", "matiere_id", "trimestre", "annee_scolaire"],
  order: "x.date_eval DESC, x.id DESC",
  scope: (req, db) => classScope(req, db),
  cols: `x.*,(SELECT niveau FROM classes c WHERE c.id=x.classe_id) AS classe_niveau,(SELECT section FROM classes c WHERE c.id=x.classe_id) AS classe_section,
    (SELECT nom FROM matieres m WHERE m.id=x.matiere_id) AS matiere,(SELECT count(*)::int FROM notes n WHERE n.evaluation_id=x.id) AS nb_notes`,
  schema: {
    classe_id: { type: "ref", table: "classes", req: true, label: "Classe" },
    matiere_id: { type: "ref", table: "matieres", req: true, label: "Matière" },
    titre: { type: "str", min: 3, max: 120, req: true, label: "Titre" },
    type: {
      type: "enum",
      values: ["controle", "devoir_surveille", "examen"],
      req: true,
      label: "Type",
    },
    trimestre: { type: "int", min: 1, max: 3, req: true, label: "Trimestre" },
    date_eval: { type: "date", req: true, label: "Date" },
    bareme: { type: "num", min: 1, max: 100, def: 20, label: "Barème" },
  },
  async before(db, d, req, old) {
    if (
      req.user.role === "enseignant" &&
      !(await teachesClass(db, req.user.id, d.classe_id, d.matiere_id))
    )
      throw new HttpError(
        403,
        "Vous n'enseignez pas cette matière dans cette classe",
      );
    const c = await db.find("classes", d.classe_id);
    d.annee_scolaire = c.annee_scolaire;
    const [a, b] = schoolYearRange(c.annee_scolaire);
    if (d.date_eval < a || d.date_eval > b)
      throw new HttpError(
        400,
        `Date : doit être comprise dans l'année scolaire ${c.annee_scolaire}`,
      );
    if (old) {
      const n = (
        await db.one(
          "SELECT count(*)::int n FROM notes WHERE evaluation_id=$1 AND school_id=$2",
          [old.id, db.sid],
        )
      ).n;
      if (
        n &&
        (d.classe_id !== old.classe_id || d.matiere_id !== old.matiere_id)
      )
        throw new HttpError(
          400,
          "Classe/matière non modifiables : des notes sont déjà saisies",
        );
      const mx = (
        await db.one(
          "SELECT COALESCE(max(valeur),0) m FROM notes WHERE evaluation_id=$1 AND school_id=$2",
          [old.id, db.sid],
        )
      ).m;
      if (d.bareme < mx)
        throw new HttpError(400, `Barème : une note de ${mx} existe déjà`);
    }
  },
  refs: [
    ["notes", "evaluation_id", "note(s) saisie(s) (supprimez-les d'abord)"],
  ],
});

async function evalForTeacher(req, db, id) {
  const e = await db.find("evaluations", Number(id) || 0);
  if (!e) throw new HttpError(404, "Introuvable");
  if (
    req.user.role === "enseignant" &&
    !(await teachesClass(db, req.user.id, e.classe_id, e.matiere_id))
  )
    throw new HttpError(404, "Introuvable");
  return e;
}
router.get(
  "/evaluations/:id/notes",
  auth,
  allow("admin", "enseignant"),
  h(async (req, res, db) => {
    const e = await evalForTeacher(req, db, req.params.id);
    const eleves = await db.q(
      `SELECT el.id,el.nom,el.prenom,el.matricule,n.valeur,n.commentaire FROM eleves el
    LEFT JOIN notes n ON n.eleve_id=el.id AND n.evaluation_id=$3 AND n.school_id=el.school_id
    WHERE el.school_id=$1 AND el.classe_id=$2 AND el.deleted_at IS NULL ORDER BY el.nom,el.prenom`,
      [db.sid, e.classe_id, e.id],
    );
    return { evaluation: e, eleves };
  }),
);
// Saisie / modification / suppression des notes (valeur vide = suppression)
router.put(
  "/evaluations/:id/notes",
  auth,
  allow("admin", "enseignant"),
  h(async (req, res, db) => {
    const e = await evalForTeacher(req, db, req.params.id),
      list = Array.isArray(req.body?.notes) ? req.body.notes : [];
    const errs = [],
      ops = [];
    const members = new Set(
      (
        await db.q(
          "SELECT id FROM eleves WHERE school_id=$1 AND classe_id=$2 AND deleted_at IS NULL",
          [db.sid, e.classe_id],
        )
      ).map((r) => r.id),
    );
    for (const n of list) {
      const id = Number(n.eleve_id);
      if (!members.has(id)) {
        errs.push(`Élève ${n.eleve_id} : n'appartient pas à la classe`);
        continue;
      }
      const raw =
        n.valeur === "" || n.valeur == null
          ? null
          : Number(String(n.valeur).replace(",", "."));
      if (
        raw !== null &&
        (!Number.isFinite(raw) ||
          raw < 0 ||
          raw > e.bareme ||
          Math.round(raw * 100) !== raw * 100)
      ) {
        errs.push(
          `Élève ${id} : note invalide (0 à ${e.bareme}, 2 décimales maximum)`,
        );
        continue;
      }
      const com = n.commentaire
        ? String(n.commentaire).trim().slice(0, 255)
        : null;
      ops.push({ id, raw, com });
    }
    if (errs.length) throw new HttpError(400, errs.slice(0, 5).join(" ; "));
    let nb = 0;
    for (const o of ops) {
      const old = await db.one(
        "SELECT valeur,commentaire FROM notes WHERE evaluation_id=$1 AND eleve_id=$2 AND school_id=$3",
        [e.id, o.id, db.sid],
      );
      if (o.raw === null) {
        if (old) {
          await db.q(
            "DELETE FROM notes WHERE evaluation_id=$1 AND eleve_id=$2 AND school_id=$3",
            [e.id, o.id, db.sid],
          );
          await audit(
            db,
            req.user,
            "SUPPR",
            "notes",
            o.id,
            { evaluation: e.id, ...old },
            null,
          );
          nb++;
        }
        continue;
      }
      if (old && old.valeur === o.raw && (old.commentaire || null) === o.com)
        continue;
      await db.q(
        `INSERT INTO notes (school_id,evaluation_id,eleve_id,valeur,commentaire) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (evaluation_id,eleve_id) DO UPDATE SET valeur=EXCLUDED.valeur,commentaire=EXCLUDED.commentaire`,
        [db.sid, e.id, o.id, o.raw, o.com],
      );
      await audit(
        db,
        req.user,
        old ? "MODIF" : "AJOUT",
        "notes",
        o.id,
        old ? { evaluation: e.id, ...old } : null,
        { evaluation: e.id, valeur: o.raw, commentaire: o.com },
      );
      nb++;
    }
    return { ok: true, modifiees: nb };
  }),
);

// Notes d'un élève (parents / élève / enseignant / administration)
router.get(
  "/eleves/:id/notes",
  auth,
  allow("admin", "enseignant", "parent", "eleve"),
  h(async (req, res, db) => {
    const e = await mustSeeEleve(req, db, req.params.id),
      annee = req.query.annee || req.user.school.annee_courante;
    return db.q(
      `SELECT n.id,ev.titre,ev.type,ev.date_eval,ev.trimestre,ev.bareme,n.valeur,n.commentaire,m.nom AS matiere,m.coefficient,round(n.valeur/ev.bareme*20,2)::float AS note20
    FROM notes n JOIN evaluations ev ON ev.id=n.evaluation_id AND ev.deleted_at IS NULL JOIN matieres m ON m.id=ev.matiere_id
    WHERE n.school_id=$1 AND n.eleve_id=$2 AND ev.annee_scolaire=$3 ORDER BY ev.date_eval DESC`,
      [db.sid, e.id, annee],
    );
  }),
);

// ───────────── Bulletins : moyenne par matière (/20) puis moyenne générale pondérée par les coefficients ─────────────
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
async function computeBulletin(db, eleve, trimestre, annee) {
  const rows = await db.q(
    `SELECT n.eleve_id,ev.classe_id,m.id mid,m.nom,m.coefficient,n.valeur/ev.bareme*20 AS n20
    FROM notes n JOIN evaluations ev ON ev.id=n.evaluation_id AND ev.deleted_at IS NULL JOIN matieres m ON m.id=ev.matiere_id
    WHERE n.school_id=$1 AND ev.annee_scolaire=$2 AND ev.trimestre=$3 AND ev.classe_id IN
      (SELECT ev2.classe_id FROM notes n2 JOIN evaluations ev2 ON ev2.id=n2.evaluation_id WHERE n2.eleve_id=$4 AND n2.school_id=$1 AND ev2.annee_scolaire=$2 AND ev2.trimestre=$3)`,
    [db.sid, annee, trimestre, eleve.id],
  );
  const byEleve = new Map();
  for (const r of rows) {
    if (!byEleve.has(r.eleve_id)) byEleve.set(r.eleve_id, new Map());
    const mm = byEleve.get(r.eleve_id);
    if (!mm.has(r.mid))
      mm.set(r.mid, { nom: r.nom, coef: r.coefficient, n: [] });
    mm.get(r.mid).n.push(r.n20);
  }
  const general = (mm) => {
    let s = 0,
      c = 0;
    for (const m of mm.values()) {
      s += avg(m.n) * m.coef;
      c += m.coef;
    }
    return c ? s / c : null;
  };
  const gens = [...byEleve.entries()]
    .map(([id, mm]) => [id, general(mm)])
    .filter((x) => x[1] !== null);
  const mine = byEleve.get(eleve.id) || new Map(),
    mg = general(mine);
  const classAvg = (mid) => {
    const v = [...byEleve.values()]
      .filter((mm) => mm.has(mid))
      .map((mm) => avg(mm.get(mid).n));
    return v.length ? avg(v) : null;
  };
  const matieres = [...mine.entries()]
    .map(([mid, m]) => ({
      matiere: m.nom,
      coefficient: m.coef,
      moyenne: avg(m.n),
      moyenne_classe: classAvg(mid),
    }))
    .sort((a, b) => a.matiere.localeCompare(b.matiere));
  const abs = await db.one(
    `SELECT count(*)::int total, count(*) FILTER (WHERE NOT justifiee)::int nj FROM absences WHERE school_id=$1 AND eleve_id=$2 AND annee_scolaire=$3`,
    [db.sid, eleve.id, annee],
  );
  const cl = rows.length
    ? await db.one(
        "SELECT niveau,section FROM classes WHERE id=$1 AND school_id=$2",
        [rows.find((r) => r.eleve_id === eleve.id)?.classe_id || 0, db.sid],
      )
    : null;
  const appr =
    mg === null
      ? "Aucune note disponible pour ce trimestre."
      : mg >= 16
        ? "Excellent travail, félicitations."
        : mg >= 14
          ? "Très bon trimestre."
          : mg >= 12
            ? "Bon travail, continuez ainsi."
            : mg >= 10
              ? "Résultats satisfaisants, peut mieux faire."
              : "Des efforts sont nécessaires, un soutien est conseillé.";
  return {
    eleve,
    annee,
    trimestre,
    classe: cl ? classLabel(cl) : null,
    matieres,
    moyenne_generale: mg,
    rang: mg === null ? null : 1 + gens.filter((g) => g[1] > mg + 1e-9).length,
    effectif: gens.length,
    absences: { total: abs.total, non_justifiees: abs.nj },
    appreciation: appr,
  };
}
async function bulletinParams(req, db) {
  const e = await mustSeeEleve(req, db, req.params.id),
    t = Number(req.query.trimestre);
  if (![1, 2, 3].includes(t)) throw new HttpError(400, "Trimestre : 1, 2 ou 3");
  const annee = /^\d{4}-\d{4}$/.test(req.query.annee || "")
    ? req.query.annee
    : req.user.school.annee_courante;
  return computeBulletin(db, e, t, annee);
}
router.get(
  "/eleves/:id/bulletin",
  auth,
  allow("admin", "enseignant", "parent", "eleve"),
  h((req, res, db) => bulletinParams(req, db)),
);
router.get(
  "/eleves/:id/bulletin.pdf",
  auth,
  allow("admin", "enseignant", "parent", "eleve"),
  h(async (req, res, db) => {
    const b = await bulletinParams(req, db);
    pdf.bulletin(
      res,
      await db.one("SELECT name,adresse,telephone FROM schools WHERE id=$1", [
        db.sid,
      ]),
      b,
    );
  }),
);

// ───────────── Absences ─────────────
crud(router, "absences", {
  table: "absences",
  read: ["admin", "enseignant", "parent", "eleve"],
  write: ["admin", "enseignant"],
  filters: ["eleve_id", "annee_scolaire"],
  order: "x.date_absence DESC",
  scope: (req, db) => eleveScope(req, db),
  cols: `x.*,(SELECT nom||' '||prenom FROM eleves e WHERE e.id=x.eleve_id) AS eleve`,
  schema: {
    eleve_id: { type: "ref", table: "eleves", req: true, label: "Élève" },
    date_absence: { type: "date", req: true, noFuture: true, label: "Date" },
    periode: {
      type: "enum",
      values: ["matin", "apres_midi", "journee"],
      def: "journee",
      label: "Période",
    },
    motif: { type: "str", max: 255, label: "Motif" },
    justifiee: { type: "bool", def: false, label: "Justifiée" },
    justification: { type: "str", max: 500, label: "Justification" },
  },
  async before(db, d, req, old) {
    if (!(await canSeeEleve(req, db, d.eleve_id)))
      throw new HttpError(403, "Cet élève n'est pas dans vos classes");
    const annee = req.user.school.annee_courante;
    if (d.date_absence < schoolYearRange(annee)[0])
      throw new HttpError(400, `Date : antérieure à l'année scolaire ${annee}`);
    const dow = new Date(d.date_absence + "T00:00:00Z").getUTCDay();
    if (dow === 0)
      throw new HttpError(
        400,
        "Date : le dimanche n'est pas un jour de classe",
      );
    d.annee_scolaire = old?.annee_scolaire || annee;
  },
});
router.put(
  "/absences/:id/justifier",
  auth,
  allow("parent"),
  h(async (req, res, db) => {
    const a = await db.find("absences", Number(req.params.id) || 0);
    if (!a || !(await canSeeEleve(req, db, a.eleve_id)))
      throw new HttpError(404, "Introuvable");
    const d = await check(
      req.body || {},
      {
        justification: {
          type: "str",
          min: 3,
          max: 500,
          req: true,
          label: "Justification",
        },
      },
      db,
    );
    await db.update("absences", a.id, {
      justification: d.justification,
      justifiee: true,
    });
    await audit(
      db,
      req.user,
      "MODIF",
      "absences",
      a.id,
      { justifiee: a.justifiee, justification: a.justification },
      { justifiee: true, justification: d.justification },
    );
    return { ok: true };
  }),
);

module.exports = router;
