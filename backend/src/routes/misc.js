const express = require("express");
const { HttpError } = require("../db");
const { auth, allow, h, bcrypt } = require("../auth");
const { check, checkPassword } = require("../validate");
const router = express.Router();
const { sendEmail } = require("../notify");
const { creerMatieres, creerSalles } = require("../programme");

router.get("/health", (req, res) => res.json({ ok: true }));
router.get("/config", (req, res) =>
  res.json({ demo: process.env.SEED_DEMO !== "false" }),
);

// ───────────── Notifications (in-app ; le navigateur affiche aussi une notification push si autorisé) ─────────────
router.get(
  "/notifications",
  auth,
  h(async (req, res, db) => {
    if (!db.sid) return { non_lues: 0, items: [] };
    const items = await db.q(
      "SELECT id,titre,texte,lien,lu,created_at FROM notifications WHERE school_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 40",
      [db.sid, req.user.id],
    );
    return {
      non_lues: (
        await db.one(
          "SELECT count(*)::int n FROM notifications WHERE school_id=$1 AND user_id=$2 AND NOT lu",
          [db.sid, req.user.id],
        )
      ).n,
      items,
    };
  }),
);
router.post(
  "/notifications/lues",
  auth,
  h(async (req, res, db) => {
    if (db.sid)
      await db.q(
        "UPDATE notifications SET lu=true WHERE school_id=$1 AND user_id=$2",
        [db.sid, req.user.id],
      );
    return { ok: true };
  }),
);

// ───────────── Journal d'actions ─────────────
router.get(
  "/journal",
  auth,
  allow("admin", "comptable"),
  h((req, res, db) => {
    const p = [db.sid];
    let sql = `SELECT j.id,j.action,j.entite,j.entite_id,j.anciennes,j.nouvelles,j.created_at,(SELECT nom||' '||prenom FROM users u WHERE u.id=j.user_id) AS utilisateur
    FROM journal j WHERE j.school_id=$1`;
    // La direction ne voit pas le journal financier (montants) ; le comptable ne voit que celui-ci.
    sql +=
      req.user.role === "comptable"
        ? " AND j.entite IN ('paiements','tarifs')"
        : " AND j.entite NOT IN ('paiements','tarifs')";
    if (req.query.entite) {
      p.push(String(req.query.entite));
      sql += ` AND j.entite=$${p.length}`;
    }
    if (req.query.action) {
      p.push(String(req.query.action));
      sql += ` AND j.action=$${p.length}`;
    }
    return db.q(sql + " ORDER BY j.id DESC LIMIT 300", p);
  }),
);
router.get(
  "/envois-log",
  auth,
  allow("admin"),
  h((req, res, db) =>
    db.q(
      `SELECT l.id,l.canal,l.sujet,l.statut,l.created_at,(SELECT nom||' '||prenom FROM users u WHERE u.id=l.destinataire_id) AS destinataire
  FROM envois_log l WHERE l.school_id=$1 ORDER BY l.id DESC LIMIT 200`,
      [db.sid],
    ),
  ),
);

// ───────────── Tableau de bord ─────────────
router.get(
  "/stats",
  auth,
  h(async (req, res, db) => {
    const u = req.user,
      annee = u.school?.annee_courante;
    if (u.role === "superadmin") {
      const r =
        await db.q(`SELECT (SELECT count(*)::int FROM schools) ecoles,(SELECT count(*)::int FROM schools WHERE status='active') actives,(SELECT count(*)::int FROM schools WHERE status='trial') essai,
      (SELECT count(*)::int FROM schools WHERE status='suspended') suspendues,(SELECT count(*)::int FROM users WHERE role<>'superadmin') utilisateurs,(SELECT count(*)::int FROM eleves WHERE deleted_at IS NULL) eleves`);
      return r[0];
    }
    const c = async (sql, p = []) => (await db.one(sql, [db.sid, ...p])).n;
    const out = {
      annee,
      non_lus: await c(
        `SELECT count(*)::int n FROM message_destinataires d JOIN messages m ON m.id=d.message_id WHERE d.school_id=$1 AND d.destinataire_id=$2 AND NOT d.lu AND NOT d.masque AND m.statut='envoye'`,
        [u.id],
      ),
    };
    if (u.role === "admin" || u.role === "comptable") {
      out.soldes = await db.one(
        `WITH s AS (SELECT COALESCE((SELECT sum(montant) FROM tarifs t WHERE t.school_id=e.school_id AND t.annee_scolaire=$2),0) du,
        COALESCE((SELECT sum(montant) FROM paiements p WHERE p.eleve_id=e.id AND p.school_id=e.school_id AND p.annee_scolaire=$2 AND p.deleted_at IS NULL),0) paye
        FROM eleves e WHERE e.school_id=$1 AND e.deleted_at IS NULL AND e.statut='inscrit')
      SELECT count(*) FILTER (WHERE du<=0 OR paye>=du)::int solde, count(*) FILTER (WHERE du>0 AND paye>0 AND paye<du)::int partiel, count(*) FILTER (WHERE du>0 AND paye<=0)::int impaye FROM s`,
        [db.sid, annee],
      );
      if (u.role === "comptable") {
        // comptable : finance uniquement (montants)
        out.encaisse = (
          await db.one(
            `SELECT COALESCE(sum(montant),0) v FROM paiements WHERE school_id=$1 AND annee_scolaire=$2 AND deleted_at IS NULL`,
            [db.sid, annee],
          )
        ).v;
        out.du = (
          await db.one(
            `SELECT COALESCE((SELECT sum(montant) FROM tarifs WHERE school_id=$1 AND annee_scolaire=$2),0) * (SELECT count(*) FROM eleves WHERE school_id=$1 AND deleted_at IS NULL AND statut='inscrit') v`,
            [db.sid, annee],
          )
        ).v;
      } else {
        // direction : gestion de l'école, sans aucun montant
        out.demandes = await c(
          `SELECT count(*)::int n FROM preinscriptions WHERE school_id=$1 AND statut='en_attente'`,
        );
        out.eleves = await c(
          `SELECT count(*)::int n FROM eleves WHERE school_id=$1 AND deleted_at IS NULL AND statut='inscrit'`,
        );
        out.preinscrits = await c(
          `SELECT count(*)::int n FROM eleves WHERE school_id=$1 AND deleted_at IS NULL AND statut='preinscrit'`,
        );
        out.sans_classe = await c(
          `SELECT count(*)::int n FROM eleves WHERE school_id=$1 AND deleted_at IS NULL AND statut='inscrit' AND classe_id IS NULL`,
        );
        out.classes = await c(
          `SELECT count(*)::int n FROM classes WHERE school_id=$1 AND deleted_at IS NULL AND annee_scolaire=$2`,
          [annee],
        );
        out.enseignants = await c(
          `SELECT count(*)::int n FROM users WHERE school_id=$1 AND role='enseignant' AND actif`,
        );
        out.absences_30j = await c(
          `SELECT count(*)::int n FROM absences WHERE school_id=$1 AND NOT justifiee AND date_absence > CURRENT_DATE - 30`,
        );
        out.effectifs = await db.q(
          `SELECT c.niveau,c.section,count(e.id)::int AS effectif,c.capacite FROM classes c LEFT JOIN eleves e ON e.classe_id=c.id AND e.deleted_at IS NULL
        WHERE c.school_id=$1 AND c.deleted_at IS NULL AND c.annee_scolaire=$2 GROUP BY c.id ORDER BY c.niveau,c.section`,
          [db.sid, annee],
        );
      }
    } else if (u.role === "enseignant") {
      out.classes = await c(
        `SELECT count(DISTINCT classe_id)::int n FROM affectations WHERE school_id=$1 AND enseignant_id=$2`,
        [u.id],
      );
      out.devoirs = await c(
        `SELECT count(*)::int n FROM devoirs WHERE school_id=$1 AND enseignant_id=$2 AND deleted_at IS NULL AND date_remise >= CURRENT_DATE`,
        [u.id],
      );
      out.a_corriger = await c(
        `SELECT count(*)::int n FROM depots d JOIN devoirs v ON v.id=d.devoir_id WHERE d.school_id=$1 AND v.enseignant_id=$2 AND d.note IS NULL`,
        [u.id],
      );
    } else if (u.role === "parent") {
      out.enfants = await db.q(
        `SELECT id,prenom,nom FROM eleves WHERE school_id=$1 AND parent_id=$2 AND deleted_at IS NULL`,
        [db.sid, u.id],
      );
    } else if (u.role === "eleve") {
      out.devoirs = await c(
        `SELECT count(*)::int n FROM devoirs v JOIN eleves e ON e.classe_id=v.classe_id AND e.school_id=v.school_id WHERE v.school_id=$1 AND e.user_id=$2 AND v.deleted_at IS NULL AND v.date_remise >= CURRENT_DATE
      AND NOT EXISTS (SELECT 1 FROM depots d WHERE d.devoir_id=v.id AND d.eleve_id=e.id)`,
        [u.id],
      );
    }
    return out;
  }),
);

// ───────────── Super-administrateur : gestion des écoles clientes ─────────────
const SU = [auth, allow("superadmin")];
const pdf = require("../pdf");
const SCH = {
  name: { type: "str", min: 3, max: 200, req: true, label: "Nom" },
  status: {
    type: "enum",
    values: ["trial", "active", "suspended"],
    def: "trial",
    label: "Statut",
  },
  plan: {
    type: "enum",
    values: ["basic", "standard", "premium"],
    def: "basic",
    label: "Formule",
  },
  subscription_end: { type: "date", label: "Fin d'abonnement" },
  adresse: { type: "str", max: 255, label: "Adresse" },
  telephone: { type: "tel", label: "Téléphone" },
  email: { type: "email", label: "E-mail" },
};
router.get(
  "/schools",
  ...SU,
  h(async (req, res, db) =>
    db.q(`SELECT s.*,(SELECT count(*)::int FROM users u WHERE u.school_id=s.id) AS utilisateurs,
  (SELECT count(*)::int FROM eleves e WHERE e.school_id=s.id AND e.deleted_at IS NULL) AS eleves,
  (SELECT COALESCE(sum(montant),0) FROM paiements p WHERE p.school_id=s.id AND p.deleted_at IS NULL) AS encaisse FROM schools s ORDER BY s.id`),
  ),
);

// Crée le compte directeur (mot de passe temporaire) et lui envoie ses identifiants par e-mail
const ROLES_INIT = {
  admin: { lib: "directeur", intro: "Votre espace de direction" },
  comptable: { lib: "comptable", intro: "Votre espace de comptabilité" },
};

// Crée un compte (mot de passe temporaire) et envoie ses identifiants par e-mail
async function newUser(db, school, b, role) {
  const R = ROLES_INIT[role];
  const a = await check(
    b,
    {
      email: { type: "email", req: true, label: `E-mail ${R.lib}` },
      nom: { type: "name", req: true, label: `Nom ${R.lib}` },
      prenom: { type: "name", req: true, label: `Prénom ${R.lib}` },
    },
    db,
  );
  const pwd = checkPassword(b.password);
  const u = await db.one(
    `INSERT INTO users (school_id,email,password_hash,role,nom,prenom,mdp_temporaire) VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id,email`,
    [school.id, a.email, await bcrypt.hash(pwd, 10), role, a.nom, a.prenom],
  );
  const url = (process.env.APP_URL || "http://localhost:8080").replace(
    /\/$/,
    "",
  );
  const email_statut = await sendEmail(
    db,
    u.id,
    a.email,
    `Votre compte ${R.lib} — ${school.name}`,
    [
      `Bonjour ${a.prenom} ${a.nom},`,
      "",
      `${R.intro} pour « ${school.name} » a été créé.`,
      "",
      `  Identifiant : ${a.email}`,
      `  Mot de passe temporaire : ${pwd}`,
      "",
      `Connexion : ${url}`,
      "Pour votre sécurité, vous serez invité à changer ce mot de passe dès votre première connexion.",
    ].join("\n"),
    school.id,
  );
  return { id: u.id, email: u.email, email_statut };
}
const newAdmin = (db, school, b) => newUser(db, school, b, "admin");

// Création d'une école : salles + matières automatiques + compte directeur
router.post(
  "/schools",
  ...SU,
  h(async (req, res, db) => {
    const d = await check(req.body || {}, SCH, db);
    const { nb_salles } = await check(
      req.body || {},
      {
        nb_salles: {
          type: "int",
          min: 1,
          max: 60,
          req: true,
          label: "Nombre de salles",
        },
      },
      db,
    );
    if (!req.body.admin)
      throw new HttpError(
        400,
        "Les informations du directeur sont obligatoires",
      );
    if (!req.body.comptable)
      throw new HttpError(
        400,
        "Les informations du comptable sont obligatoires",
      );
    const mail = (x) =>
      String(x?.email || "")
        .trim()
        .toLowerCase();
    if (mail(req.body.admin) === mail(req.body.comptable))
      throw new HttpError(
        400,
        "Le directeur et le comptable doivent avoir des e-mails différents",
      );
    const s = await db.one(/* … INSERT INTO schools … inchangé … */);
    await creerSalles(db, s.id, nb_salles);
    await creerMatieres(db, s.id);
    const admin = await newUser(db, s, req.body.admin, "admin");
    const comptable = await newUser(db, s, req.body.comptable, "comptable");
    res.status(201);
    return { ...s, admin, comptable };
  }),
);

router.post(
  "/schools/:id/admins",
  ...SU,
  h(async (req, res, db) => {
    const s = await db.one("SELECT id,name FROM schools WHERE id=$1", [
      Number(req.params.id) || 0,
    ]);
    if (!s) throw new HttpError(404, "Introuvable");
    res.status(201);
    return newAdmin(db, s, req.body || {});
  }),
);

router.put(
  "/schools/:id",
  ...SU,
  h(async (req, res, db) => {
    const old = await db.one("SELECT * FROM schools WHERE id=$1", [
      Number(req.params.id) || 0,
    ]);
    if (!old) throw new HttpError(404, "Introuvable");
    const d = await check({ ...old, ...req.body }, SCH, db);
    return db.one(
      `UPDATE schools SET name=$2,status=$3,plan=$4,subscription_end=$5,adresse=$6,telephone=$7,email=$8 WHERE id=$1 RETURNING *`,
      [
        old.id,
        d.name,
        d.status,
        d.plan,
        d.subscription_end,
        d.adresse,
        d.telephone,
        d.email,
      ],
    );
  }),
);

// Super-administrateur : accès (lecture seule) à toutes les données financières de chaque école
router.get(
  "/schools/:id/finance",
  ...SU,
  h(async (req, res, db) => {
    const id = Number(req.params.id) || 0,
      s = await db.one(
        "SELECT id,name,annee_courante FROM schools WHERE id=$1",
        [id],
      );
    if (!s) throw new HttpError(404, "Introuvable");
    const annee = /^\d{4}-\d{4}$/.test(req.query.annee || "")
      ? req.query.annee
      : s.annee_courante;
    const tarifs = await db.q(
      "SELECT id,libelle,montant FROM tarifs WHERE school_id=$1 AND annee_scolaire=$2 ORDER BY id",
      [id, annee],
    );
    const du = tarifs.reduce((a, t) => a + t.montant, 0);
    const rows = await db.q(
      `SELECT e.id,e.nom,e.prenom,e.matricule,(SELECT niveau||section FROM classes c WHERE c.id=e.classe_id) AS classe,
    COALESCE((SELECT sum(montant) FROM paiements p WHERE p.eleve_id=e.id AND p.school_id=e.school_id AND p.annee_scolaire=$2 AND p.deleted_at IS NULL),0) AS paye
    FROM eleves e WHERE e.school_id=$1 AND e.deleted_at IS NULL AND e.statut='inscrit' ORDER BY e.nom,e.prenom`,
      [id, annee],
    );
    const soldes = rows.map((r) => ({
      ...r,
      du,
      reste: Math.round((du - r.paye) * 100) / 100,
    }));
    const paiements = await db.q(
      `SELECT p.id,p.numero_recu,p.date_paiement,p.montant,p.mode,p.libelle,p.reference,(SELECT nom||' '||prenom FROM eleves e WHERE e.id=p.eleve_id) AS eleve,
    (SELECT nom||' '||prenom FROM users u WHERE u.id=p.saisi_par) AS saisi_par FROM paiements p WHERE p.school_id=$1 AND p.annee_scolaire=$2 AND p.deleted_at IS NULL ORDER BY p.date_paiement DESC,p.id DESC`,
      [id, annee],
    );
    const encaisse = paiements.reduce((a, p) => a + p.montant, 0);
    return {
      ecole: s,
      annee,
      tarifs,
      soldes,
      paiements,
      totaux: {
        du: du * soldes.length,
        encaisse,
        reste: Math.round((du * soldes.length - encaisse) * 100) / 100,
      },
    };
  }),
);
router.get(
  "/schools/:id/paiements/:pid/recu",
  ...SU,
  h(async (req, res, db) => {
    const id = Number(req.params.id) || 0,
      school = await db.one(
        "SELECT name,adresse,telephone FROM schools WHERE id=$1",
        [id],
      );
    const p =
      school &&
      (await db.one(
        "SELECT * FROM paiements WHERE id=$1 AND school_id=$2 AND deleted_at IS NULL",
        [Number(req.params.pid) || 0, id],
      ));
    if (!p) throw new HttpError(404, "Introuvable");
    const e = await db.one(
      "SELECT * FROM eleves WHERE id=$1 AND school_id=$2",
      [p.eleve_id, id],
    );
    const classe =
      e.classe_id &&
      (await db.one(
        "SELECT niveau,section FROM classes WHERE id=$1 AND school_id=$2",
        [e.classe_id, id],
      ));
    const parent =
      e.parent_id &&
      (await db.one(
        "SELECT nom,prenom FROM users WHERE id=$1 AND school_id=$2",
        [e.parent_id, id],
      ));
    const du = (
      await db.one(
        "SELECT COALESCE(sum(montant),0) v FROM tarifs WHERE school_id=$1 AND annee_scolaire=$2",
        [id, p.annee_scolaire],
      )
    ).v;
    const paye = (
      await db.one(
        "SELECT COALESCE(sum(montant),0) v FROM paiements WHERE school_id=$1 AND eleve_id=$2 AND annee_scolaire=$3 AND deleted_at IS NULL",
        [id, e.id, p.annee_scolaire],
      )
    ).v;
    pdf.recu(res, school, p, e, classe, parent, paye, du);
  }),
);

module.exports = router;
