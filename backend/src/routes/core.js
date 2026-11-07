const express = require("express");
const { HttpError, audit, tx } = require("../db");
const { auth, allow, h, bcrypt } = require("../auth");
const {
  check,
  checkPassword,
  checkNaissance,
  startYear,
  today,
} = require("../validate");
const {
  classScope,
  eleveScope,
  mustSeeEleve,
  classLabel,
} = require("../access");
const { notify } = require("../notify");
const crud = require("../crud");
const { upload, saveFile } = require("../files");
const router = express.Router();
const STAFF = ["admin"]; // gestion des dossiers : direction uniquement (le comptable n'a accès qu'à la finance)
const accounts = require("../accounts");

// ───────────── École courante & changement d'année ─────────────
router.get(
  "/ecole",
  auth,
  allow("admin", "enseignant", "parent", "eleve"),
  h((req, res, db) =>
    db.one(
      "SELECT id,name,adresse,telephone,email,annee_courante,status,plan,subscription_end FROM schools WHERE id=$1",
      [db.sid],
    ),
  ),
);

router.put(
  "/ecole",
  auth,
  allow("admin"),
  h(async (req, res, db) => {
    const d = await check(
      req.body || {},
      {
        name: { type: "str", min: 3, max: 200, req: true, label: "Nom" },
        adresse: { type: "str", max: 255, label: "Adresse" },
        telephone: { type: "tel", label: "Téléphone" },
        email: { type: "email", label: "E-mail" },
      },
      db,
    );
    const old = await db.one(
      "SELECT name,adresse,telephone,email FROM schools WHERE id=$1",
      [db.sid],
    );
    await db.q(
      "UPDATE schools SET name=$2,adresse=$3,telephone=$4,email=$5 WHERE id=$1",
      [db.sid, d.name, d.adresse, d.telephone, d.email],
    );
    await audit(db, req.user, "MODIF", "ecole", db.sid, old, d);
    return { ok: true };
  }),
);

// Passage à l'année suivante : copie des classes + promotion automatique des élèves (historique conservé)
router.post(
  "/ecole/annee",
  auth,
  allow("admin"),
  h(async (req, res, db) => {
    const cur = req.user.school.annee_courante,
      next = `${startYear(cur) + 1}-${startYear(cur) + 2}`;
    if (req.body.annee !== next)
      throw new HttpError(
        400,
        `Seule l'année suivante (${next}) peut être ouverte`,
      );
    const classes = await db.q(
      "SELECT * FROM classes WHERE school_id=$1 AND annee_scolaire=$2 AND deleted_at IS NULL",
      [db.sid, cur],
    );
    const map = {};
    for (const c of classes) {
      const n = await db.one(
        `INSERT INTO classes (school_id,niveau,section,capacite,annee_scolaire) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (school_id,annee_scolaire,niveau,section) WHERE deleted_at IS NULL DO UPDATE SET capacite=EXCLUDED.capacite RETURNING id`,
        [db.sid, c.niveau, c.section, c.capacite, next],
      );
      map[c.niveau + c.section] = n.id;
    }
    let promus = 0;
    for (const c of classes) {
      const target = c.niveau < 6 ? map[c.niveau + 1 + c.section] : null;
      const r = await db.q(
        "UPDATE eleves SET classe_id=$3 WHERE school_id=$1 AND classe_id=$2 AND deleted_at IS NULL RETURNING id",
        [db.sid, c.id, target || null],
      );
      if (target) promus += r.length;
    }
    await db.q("UPDATE schools SET annee_courante=$2 WHERE id=$1", [
      db.sid,
      next,
    ]);
    await audit(
      db,
      req.user,
      "ANNEE",
      "ecole",
      db.sid,
      { annee: cur },
      { annee: next, promus },
    );
    return { ok: true, annee: next, promus };
  }),
);

// ───────────── Utilisateurs (enseignants, parents, élèves, comptables, admins) ─────────────
const guardSelf = async (req, db, old, body) => {};
crud(router, "utilisateurs", {
  table: "users",
  read: STAFF,
  write: ["admin"],
  filters: ["role", "actif"],
  order: "x.role, x.nom, x.prenom",
  cols: "x.id,x.school_id,x.email,x.role,x.nom,x.prenom,x.telephone,x.actif,x.created_at",
  schema: {
    email: { type: "email", req: true, label: "E-mail", max: 200 },
    nom: { type: "name", req: true, label: "Nom" },
    prenom: { type: "name", req: true, label: "Prénom" },
    telephone: { type: "tel", label: "Téléphone" },
    role: {
      type: "enum",
      values: ["admin", "comptable", "enseignant", "parent", "eleve"],
      req: true,
      label: "Rôle",
    },
    actif: { type: "bool", def: true, label: "Actif" },
    password: { type: "raw", label: "Mot de passe" },
  },
  async before(db, data, req, old) {
    // Les comptes parents et élèves sont créés AUTOMATIQUEMENT lors de la validation d'une pré-inscription
    if (
      ["parent", "eleve"].includes(data.role) &&
      (!old || old.role !== data.role)
    )
      throw new HttpError(
        400,
        "Les comptes parents et élèves sont créés automatiquement lors de la validation d'une pré-inscription",
      );
    if (data.password)
      data.password_hash = await bcrypt.hash(checkPassword(data.password), 10);
    else if (!old)
      throw new HttpError(
        400,
        "Mot de passe : obligatoire à la création (8 caractères minimum, lettre + chiffre)",
      );
    delete data.password;
    if (old) {
      if (
        old.id === req.user.id &&
        (data.role !== old.role || data.actif === false)
      )
        throw new HttpError(
          400,
          "Vous ne pouvez pas modifier votre propre rôle ni désactiver votre propre compte",
        );
      if (
        old.role === "admin" &&
        (data.role !== "admin" || data.actif === false)
      ) {
        const n = (
          await db.one(
            `SELECT count(*)::int n FROM users WHERE school_id=$1 AND role='admin' AND actif AND id<>$2`,
            [db.sid, old.id],
          )
        ).n;
        if (!n)
          throw new HttpError(
            400,
            "Il doit rester au moins un administrateur actif",
          );
      }
    }
    return data;
  },
  async guard(req, db, old) {
    if (old && old.id === req.user.id && req.method === "DELETE")
      throw new HttpError(
        400,
        "Vous ne pouvez pas supprimer votre propre compte",
      );
  },
  refs: [
    ["classes", "enseignant_id", "classe(s) (titulaire)"],
    ["affectations", "enseignant_id", "affectation(s)"],
    ["creneaux", "enseignant_id", "créneau(x)"],
    ["devoirs", "enseignant_id", "devoir(s)"],
    ["eleves", "parent_id", "élève(s) (parent)"],
    ["eleves", "user_id", "dossier(s) élève"],
  ],
});
router.post(
  "/auth/mot-de-passe",
  auth,
  h(async (req, res, db) => {
    const { ancien, nouveau } = req.body || {};
    const u = await db.q("SELECT password_hash FROM users WHERE id=$1", [
      req.user.id,
    ]);
    if (!(await bcrypt.compare(String(ancien || ""), u[0].password_hash)))
      throw new HttpError(400, "Ancien mot de passe incorrect");
    const hash = await bcrypt.hash(checkPassword(nouveau), 10);
    await db.q(
      "UPDATE users SET password_hash=$2, mdp_temporaire=false WHERE id=$1",
      [req.user.id, hash],
    );
    if (db.sid)
      await audit(
        db,
        req.user,
        "MODIF",
        "mot_de_passe",
        req.user.id,
        null,
        null,
      );
    return { ok: true };
  }),
);

// ───────────── Classes ─────────────
crud(router, "classes", {
  table: "classes",
  read: ["admin", "enseignant"],
  write: ["admin"],
  filters: ["annee_scolaire", "niveau"],
  order: "x.annee_scolaire DESC, x.niveau, x.section",
  cols: `x.*, (SELECT count(*)::int FROM eleves e WHERE e.classe_id=x.id AND e.school_id=x.school_id AND e.deleted_at IS NULL) AS effectif,
    (SELECT nom||' '||prenom FROM users u WHERE u.id=x.enseignant_id) AS enseignant`,
  schema: {
    niveau: { type: "int", min: 1, max: 6, req: true, label: "Niveau (1 à 6)" },
    section: {
      type: "str",
      min: 1,
      max: 3,
      req: true,
      pattern: /^[A-Za-z0-9]+$/,
      patternMsg: "lettres/chiffres uniquement",
      label: "Section",
    },
    capacite: { type: "int", min: 5, max: 40, req: true, label: "Capacité" },
    annee_scolaire: { type: "annee", label: "Année scolaire" },
    enseignant_id: {
      type: "ref",
      table: "users",
      role: "enseignant",
      label: "Enseignant titulaire",
    },
  },
  async before(db, data, req, old) {
    data.section = data.section.toUpperCase();
    data.annee_scolaire =
      data.annee_scolaire ||
      old?.annee_scolaire ||
      req.user.school.annee_courante;
    if (old) {
      const eff = (
        await db.one(
          "SELECT count(*)::int n FROM eleves WHERE classe_id=$1 AND school_id=$2 AND deleted_at IS NULL",
          [old.id, db.sid],
        )
      ).n;
      if (data.capacite < eff)
        throw new HttpError(
          400,
          `Capacité : ${eff} élève(s) sont déjà affectés (minimum ${eff})`,
        );
      if (
        eff &&
        (data.niveau !== old.niveau ||
          data.annee_scolaire !== old.annee_scolaire)
      )
        throw new HttpError(
          400,
          "Niveau/année non modifiables : des élèves sont affectés à cette classe",
        );
    }
  },
  refs: [
    ["eleves", "classe_id", "élève(s)"],
    ["creneaux", "classe_id", "créneau(x)"],
    ["evaluations", "classe_id", "évaluation(s)"],
    ["devoirs", "classe_id", "devoir(s)"],
    ["affectations", "classe_id", "affectation(s)"],
  ],
});

// ───────────── Matières ─────────────
crud(router, "matieres", {
  table: "matieres",
  read: ["admin", "enseignant"],
  write: ["admin"],
  filters: ["niveau"],
  order: "x.nom, x.niveau",
  schema: {
    nom: { type: "str", min: 2, max: 80, req: true, label: "Nom" },
    coefficient: {
      type: "num",
      min: 0.5,
      max: 10,
      req: true,
      label: "Coefficient (0,5 à 10)",
    },
    niveau: { type: "int", min: 1, max: 6, label: "Niveau (vide = tous)" },
  },
  refs: [
    ["evaluations", "matiere_id", "évaluation(s)/note(s)"],
    ["affectations", "matiere_id", "affectation(s) enseignant"],
    ["creneaux", "matiere_id", "créneau(x)"],
    ["devoirs", "matiere_id", "devoir(s)"],
  ],
});

// ───────────── Salles ─────────────
crud(router, "salles", {
  table: "salles",
  read: ["admin", "enseignant"],
  write: ["admin"],
  order: "x.nom",
  schema: {
    nom: { type: "str", min: 1, max: 60, req: true, label: "Nom" },
    capacite: { type: "int", min: 1, max: 100, req: true, label: "Capacité" },
    disponible: { type: "bool", def: true, label: "Disponible" },
  },
  refs: [["creneaux", "salle_id", "créneau(x) d'emploi du temps"]],
});

// ───────────── Affectations enseignant ↔ matière ↔ classe ─────────────
crud(router, "affectations", {
  table: "affectations",
  read: ["admin", "enseignant"],
  write: ["admin"],
  filters: ["classe_id", "enseignant_id"],
  order: "x.id",
  cols: `x.*, (SELECT nom||' '||prenom FROM users u WHERE u.id=x.enseignant_id) AS enseignant, (SELECT nom FROM matieres m WHERE m.id=x.matiere_id) AS matiere,
    (SELECT niveau||'/'||section||' ('||annee_scolaire||')' FROM classes c WHERE c.id=x.classe_id) AS classe`,
  schema: {
    enseignant_id: {
      type: "ref",
      table: "users",
      role: "enseignant",
      req: true,
      label: "Enseignant",
    },
    matiere_id: { type: "ref", table: "matieres", req: true, label: "Matière" },
    classe_id: { type: "ref", table: "classes", req: true, label: "Classe" },
  },
  async before(db, data) {
    const m = await db.find("matieres", data.matiere_id),
      c = await db.find("classes", data.classe_id);
    if (m.niveau && m.niveau !== c.niveau)
      throw new HttpError(
        400,
        `Cette matière est réservée au niveau ${m.niveau}`,
      );
  },
});

// ───────────── Tarifs ─────────────
crud(router, "tarifs", {
  table: "tarifs",
  read: ["comptable"],
  write: ["comptable"],
  filters: ["annee_scolaire"],
  order: "x.annee_scolaire DESC, x.id",
  schema: {
    annee_scolaire: { type: "annee", label: "Année scolaire" },
    libelle: { type: "str", min: 3, max: 100, req: true, label: "Libellé" },
    montant: {
      type: "num",
      min: 0.01,
      max: 100000,
      req: true,
      label: "Montant",
    },
  },
  before: async (db, d, req, old) => {
    d.annee_scolaire =
      d.annee_scolaire || old?.annee_scolaire || req.user.school.annee_courante;
  },
});

// ───────────── Élèves ─────────────
const eleveSchema = {
  matricule: {
    type: "str",
    min: 3,
    max: 20,
    pattern: /^[A-Za-z0-9-]+$/,
    patternMsg: "lettres, chiffres, tirets",
    label: "Matricule",
  },
  nom: { type: "name", req: true, label: "Nom" },
  prenom: { type: "name", req: true, label: "Prénom" },
  date_naissance: {
    type: "date",
    req: true,
    noFuture: true,
    label: "Date de naissance",
  },
  sexe: { type: "enum", values: ["M", "F"], req: true, label: "Sexe" },
  adresse: { type: "str", max: 255, label: "Adresse" },
  antecedents_medicaux: {
    type: "str",
    max: 1000,
    label: "Antécédents médicaux",
  },
  annee_entree: { type: "int", min: 2000, max: 2100, label: "Année d'entrée" },
  statut: {
    type: "enum",
    values: ["preinscrit", "inscrit"],
    def: "inscrit",
    label: "Statut",
  },
  classe_id: { type: "ref", table: "classes", label: "Classe" },
  parent_id: {
    type: "ref",
    table: "users",
    role: "parent",
    label: "Parent / tuteur",
  },
  user_id: {
    type: "ref",
    table: "users",
    role: "eleve",
    label: "Compte élève",
  },
};
async function eleveBefore(db, data, req, old) {
  const annee = req.user.school.annee_courante,
    S = startYear(annee);
  let classe = null;
  if (data.classe_id) {
    classe = await db.find("classes", data.classe_id);
    if (classe.annee_scolaire !== annee)
      throw new HttpError(
        400,
        `Classe : seules les classes de l'année en cours (${annee}) sont utilisables`,
      );
    if (!old || old.classe_id !== classe.id) {
      const eff = (
        await db.one(
          "SELECT count(*)::int n FROM eleves WHERE classe_id=$1 AND school_id=$2 AND deleted_at IS NULL",
          [classe.id, db.sid],
        )
      ).n;
      if (eff >= classe.capacite)
        throw new HttpError(
          400,
          `La classe ${classLabel(classe)} est complète (${classe.capacite} élèves maximum)`,
        );
    }
  }
  checkNaissance(data.date_naissance, annee, classe?.niveau);
  const by = parseInt(data.date_naissance.slice(0, 4), 10);
  data.annee_entree = data.annee_entree ?? (old?.annee_entree || S);
  if (data.annee_entree < by + 6)
    throw new HttpError(
      400,
      "Année d'entrée : l'élève doit avoir au moins 6 ans à l'entrée",
    );
  if (data.annee_entree > S)
    throw new HttpError(400, `Année d'entrée : ne peut pas dépasser ${S}`);
  if (data.user_id) {
    const dup = await db.one(
      "SELECT id FROM eleves WHERE user_id=$1 AND school_id=$2 AND deleted_at IS NULL AND id<>$3",
      [data.user_id, db.sid, old?.id || 0],
    );
    if (dup)
      throw new HttpError(
        400,
        "Ce compte élève est déjà associé à un autre dossier",
      );
  }
  if (!data.matricule) {
    let n =
        (
          await db.one(
            "SELECT count(*)::int n FROM eleves WHERE school_id=$1",
            [db.sid],
          )
        ).n + 1,
      m;
    do {
      m = `EL${data.annee_entree}-${String(n++).padStart(4, "0")}`;
    } while (
      await db.one(
        "SELECT 1 FROM eleves WHERE school_id=$1 AND matricule=$2 AND deleted_at IS NULL",
        [db.sid, m],
      )
    );
    data.matricule = m;
  } else data.matricule = data.matricule.toUpperCase();
  return data;
}
const eleveScopeFn = (req, db) => eleveScope(req, db, "x.id");

router.get(
  "/eleves/export",
  auth,
  allow(...STAFF),
  h(async (req, res, db) => {
    const rows = await db.q(
      `SELECT e.matricule,e.nom,e.prenom,e.date_naissance,e.sexe,e.adresse,e.annee_entree,e.statut,
    (SELECT niveau||section FROM classes c WHERE c.id=e.classe_id) AS classe,(SELECT email FROM users u WHERE u.id=e.parent_id) AS parent_email
    FROM eleves e WHERE e.school_id=$1 AND e.deleted_at IS NULL ORDER BY e.nom,e.prenom`,
      [db.sid],
    );
    const cols = [
      "matricule",
      "nom",
      "prenom",
      "date_naissance",
      "sexe",
      "adresse",
      "annee_entree",
      "statut",
      "classe",
      "parent_email",
    ];
    const esc = (v) => {
      v = v == null ? "" : String(v);
      return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="eleves.csv"');
    res.send(
      "\ufeff" +
        cols.join(";") +
        "\n" +
        rows.map((r) => cols.map((c) => esc(r[c])).join(";")).join("\n"),
    );
  }),
);

router.post(
  "/eleves/import",
  auth,
  allow(...STAFF),
  h(async (req, res, db) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows || !rows.length)
      throw new HttpError(400, "Aucune ligne à importer");
    if (rows.length > 500)
      throw new HttpError(400, "500 lignes maximum par import");
    let ok = 0;
    const erreurs = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      await db.q("SAVEPOINT imp");
      try {
        const body = { ...r };
        if (r.parent_email) {
          const p = await db.one(
            `SELECT id FROM users WHERE school_id=$1 AND role='parent' AND lower(email)=lower($2)`,
            [db.sid, String(r.parent_email).trim()],
          );
          if (!p)
            throw new HttpError(400, `Parent introuvable (${r.parent_email})`);
          body.parent_id = p.id;
        }
        const m = /^(\d)\s*([A-Za-z0-9]{1,3})$/.exec(
          String(r.classe || "").trim(),
        );
        if (m) {
          const c = await db.one(
            "SELECT id FROM classes WHERE school_id=$1 AND annee_scolaire=$2 AND niveau=$3 AND upper(section)=upper($4) AND deleted_at IS NULL",
            [db.sid, req.user.school.annee_courante, +m[1], m[2]],
          );
          if (!c) throw new HttpError(400, `Classe introuvable (${r.classe})`);
          body.classe_id = c.id;
        } else if (r.classe)
          throw new HttpError(400, "Classe : format attendu 1A, 2B…");
        let d = await check(body, eleveSchema, db);
        d = await eleveBefore(db, d, req, null);
        const row = await db.insert("eleves", d);
        await audit(db, req.user, "AJOUT", "eleves", row.id, null, d);
        ok++;
      } catch (e) {
        await db.q("ROLLBACK TO SAVEPOINT imp");
        erreurs.push({
          ligne: i + 2,
          erreur: e.status
            ? e.message
            : e.code === "23505"
              ? "Doublon (matricule déjà utilisé)"
              : "Données invalides",
        });
      }
      await db.q("RELEASE SAVEPOINT imp").catch(() => {});
    }
    return { importes: ok, erreurs };
  }),
);

// Pré-inscription par un parent (validée ensuite par l'administration)
router.post(
  "/eleves/preinscription",
  auth,
  allow("parent"),
  h(async (req, res, db) => {
    const s = {};
    for (const k of [
      "nom",
      "prenom",
      "date_naissance",
      "sexe",
      "adresse",
      "antecedents_medicaux",
    ])
      s[k] = eleveSchema[k];
    let d = await check(req.body || {}, s, db);
    d.statut = "preinscrit";
    d.parent_id = req.user.id;
    d = await eleveBefore(db, d, req, null);
    const row = await db.insert("eleves", d);
    await audit(db, req.user, "AJOUT", "eleves", row.id, null, d);
    const admins = await db.q(
      `SELECT id FROM users WHERE school_id=$1 AND role='admin' AND actif`,
      [db.sid],
    );
    await notify(
      db,
      admins.map((a) => a.id),
      "Nouvelle pré-inscription",
      `${d.prenom} ${d.nom} (${req.user.prenom} ${req.user.nom})`,
      "#/eleves",
    );
    res.status(201);
    return row;
  }),
);

router.post(
  "/eleves/:id/affecter-auto",
  auth,
  allow(...STAFF),
  h(async (req, res, db) => {
    const e = await db.find("eleves", Number(req.params.id) || 0);
    if (!e) throw new HttpError(404, "Introuvable");
    const annee = req.user.school.annee_courante,
      S = startYear(annee);
    const niveau = Math.min(
      6,
      Math.max(1, S - parseInt(e.date_naissance.slice(0, 4), 10) - 5),
    );
    const c = await db.one(
      `SELECT c.id,c.niveau,c.section FROM classes c WHERE c.school_id=$1 AND c.annee_scolaire=$2 AND c.niveau=$3 AND c.deleted_at IS NULL
    AND (SELECT count(*) FROM eleves x WHERE x.classe_id=c.id AND x.deleted_at IS NULL) < c.capacite
    ORDER BY (SELECT count(*) FROM eleves x WHERE x.classe_id=c.id AND x.deleted_at IS NULL), c.section LIMIT 1`,
      [db.sid, annee, niveau],
    );
    if (!c)
      throw new HttpError(
        409,
        `Aucune classe disponible pour le niveau ${niveau} (créez une classe ou augmentez la capacité)`,
      );
    await db.update("eleves", e.id, { classe_id: c.id, statut: "inscrit" });
    await audit(
      db,
      req.user,
      "MODIF",
      "eleves",
      e.id,
      { classe_id: e.classe_id },
      { classe_id: c.id },
    );
    return { ok: true, classe: classLabel(c) };
  }),
);

router.post(
  "/eleves/:id/photo",
  auth,
  allow(...STAFF),
  upload.single("fichier"),
  h(async (req, res, db) => {
    const e = await db.find("eleves", Number(req.params.id) || 0);
    if (!e) throw new HttpError(404, "Introuvable");
    if (!req.file || !/^image\/(png|jpe?g|webp)$/.test(req.file.mimetype))
      throw new HttpError(400, "Photo : image PNG, JPG ou WEBP attendue");
    const f = await saveFile(db, req.user, req.file, "photo", e.id);
    await db.update("eleves", e.id, { photo_id: f.id });
    await audit(
      db,
      req.user,
      "MODIF",
      "eleves",
      e.id,
      { photo: "ancienne" },
      { photo: f.id },
    );
    return { ok: true, photo_id: f.id };
  }),
);

crud(router, "eleves", {
  table: "eleves",
  read: ["admin", "enseignant", "parent", "eleve"],
  create: STAFF,
  update: STAFF,
  remove: ["admin"],
  write: STAFF,
  filters: ["classe_id", "statut", "parent_id"],
  order: "x.nom, x.prenom",
  scope: eleveScopeFn,
  cols: `x.*, (SELECT niveau FROM classes c WHERE c.id=x.classe_id) AS classe_niveau, (SELECT section FROM classes c WHERE c.id=x.classe_id) AS classe_section,
    (SELECT nom||' '||prenom FROM users u WHERE u.id=x.parent_id) AS parent_nom`,
  schema: eleveSchema,
  async before(db, data, req, old) {
    if (req.body?.nouveau_parent) {
      // « Créer un nouveau parent » dans le formulaire élève
      const p = await accounts.ensureParent(db, req, req.body.nouveau_parent);
      data.parent_id = p.id;
      req.parentIdent = p;
    }
    return eleveBefore(db, data, req, old);
  },
  async after(db, row, req, created, old) {
    // compte élève créé à l'ajout, ou quand une pré-inscription est validée (preinscrit -> inscrit)
    const need =
      row.statut === "inscrit" &&
      !row.user_id &&
      (created || old?.statut === "preinscrit");
    const r = await accounts.provision(db, req, row, req.parentIdent, need);
    if (r) req.extra = { compte: r };
  },
});

module.exports = router;
module.exports.eleveSchema = eleveSchema;
module.exports.eleveBefore = eleveBefore;
