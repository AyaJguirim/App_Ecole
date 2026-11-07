// Pré-inscriptions : formulaire PUBLIC (parent sans compte) -> vérification par la direction -> création AUTOMATIQUE
// du compte parent (une seule fois) et du compte élève (une seule fois), identifiants envoyés par e-mail.
const express = require("express");
const crypto = require("crypto");
const { tx, HttpError, audit } = require("../db");
const { auth, allow, h, bcrypt } = require("../auth");
const { check, checkNaissance, startYear } = require("../validate");
const { classLabel } = require("../access");
const { notify, sendEmail } = require("../notify");
const { eleveBefore } = require("./core");
const router = express.Router();

const OPEN_SCHOOLS = `SELECT id,name,adresse,annee_courante FROM schools WHERE status IN ('trial','active') AND (subscription_end IS NULL OR subscription_end >= CURRENT_DATE) ORDER BY name`;
const PARENT = {
  nom: { type: "name", req: true, label: "Nom du parent" },
  prenom: { type: "name", req: true, label: "Prénom du parent" },
  email: { type: "email", req: true, label: "E-mail du parent" },
  telephone: { type: "tel", req: true, label: "Téléphone du parent" },
};
const ENFANT = {
  ecole_id: { type: "int", min: 1, req: true, label: "École" },
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
};

// Mot de passe temporaire lisible (sans caractères ambigus) : 9 lettres + 3 chiffres
function genPassword() {
  const L = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ",
    D = "23456789",
    pick = (s) => s[crypto.randomInt(s.length)];
  const chars = [...Array(9)]
    .map(() => pick(L))
    .concat([...Array(3)].map(() => pick(D)));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// ───────────── Public (sans connexion) ─────────────
router.get("/public/ecoles", async (req, res, next) => {
  try {
    res.json(await tx({ bypass: true }, (db) => db.q(OPEN_SCHOOLS)));
  } catch (e) {
    next(e);
  }
});

router.post("/public/preinscriptions", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.website) return res.status(201).json({ ok: true, envoyees: 0 }); // champ piège anti-robots
    if (b.consentement !== true)
      throw new HttpError(
        400,
        "Le consentement au traitement des données est obligatoire",
      );
    const parent = await check(b.parent || {}, PARENT, null);
    const enfants = Array.isArray(b.enfants) ? b.enfants : [];
    if (!enfants.length || enfants.length > 6)
      throw new HttpError(400, "Ajoutez entre 1 et 6 enfants");
    const schools = await tx({ bypass: true }, (db) => db.q(OPEN_SCHOOLS)),
      rows = [],
      seen = new Set();
    for (const [i, e] of enfants.entries()) {
      try {
        const d = await check(e || {}, ENFANT, null),
          school = schools.find((s) => s.id === d.ecole_id);
        if (!school)
          throw new HttpError(
            400,
            "École : choisissez une école dans la liste",
          );
        checkNaissance(d.date_naissance, school.annee_courante, null);
        const key = [d.ecole_id, d.nom, d.prenom, d.date_naissance]
          .join("|")
          .toLowerCase();
        if (seen.has(key))
          throw new HttpError(400, "cet enfant est saisi deux fois");
        seen.add(key);
        rows.push({ school, d });
      } catch (x) {
        throw x.status
          ? new HttpError(x.status, `Enfant n° ${i + 1} : ${x.message}`)
          : x;
      }
    }
    for (const { school, d } of rows)
      await tx({ bypass: true, schoolId: school.id }, async (db) => {
        const dup = await db.one(
          `SELECT 1 FROM preinscriptions WHERE school_id=$1 AND lower(parent_email)=$2 AND lower(enfant_nom)=lower($3) AND lower(enfant_prenom)=lower($4) AND date_naissance=$5 AND statut<>'refusee'`,
          [school.id, parent.email, d.nom, d.prenom, d.date_naissance],
        );
        if (dup)
          throw new HttpError(
            409,
            `Une demande existe déjà pour ${d.prenom} ${d.nom} dans « ${school.name} »`,
          );
        await db.insert("preinscriptions", {
          parent_nom: parent.nom,
          parent_prenom: parent.prenom,
          parent_email: parent.email,
          parent_telephone: parent.telephone,
          enfant_nom: d.nom,
          enfant_prenom: d.prenom,
          date_naissance: d.date_naissance,
          sexe: d.sexe,
          adresse: d.adresse,
          antecedents_medicaux: d.antecedents_medicaux,
        });
        const admins = await db.q(
          `SELECT id FROM users WHERE school_id=$1 AND role='admin' AND actif`,
          [school.id],
        );
        await notify(
          db,
          admins.map((a) => a.id),
          "Nouvelle demande de pré-inscription",
          `${d.prenom} ${d.nom} — parent : ${parent.prenom} ${parent.nom}`,
          "#/preinscriptions",
        );
        await sendEmail(
          db,
          null,
          parent.email,
          `Demande de pré-inscription reçue — ${school.name}`,
          `Bonjour ${parent.prenom} ${parent.nom},\n\nNous avons bien reçu la pré-inscription de ${d.prenom} ${d.nom} à « ${school.name} ».\n` +
            `La direction va l'examiner. Si elle est validée, vous recevrez vos identifiants de connexion par e-mail.\n\n${school.name}`,
        );
      });
    res.status(201).json({
      ok: true,
      envoyees: rows.length,
      ecoles: [...new Set(rows.map((r) => r.school.name))],
    });
  } catch (e) {
    next(e);
  }
});

// ───────────── Direction ─────────────
router.get(
  "/preinscriptions",
  auth,
  allow("admin"),
  h((req, res, db) => {
    const p = [db.sid];
    let sql = `SELECT x.*,(SELECT nom||' '||prenom FROM users u WHERE u.id=x.traite_par) AS traite_par_nom,
    EXISTS (SELECT 1 FROM users u WHERE u.school_id=x.school_id AND u.role='parent' AND lower(u.email)=lower(x.parent_email)) AS parent_existe,
    EXISTS (SELECT 1 FROM eleves e JOIN users u ON u.id=e.parent_id WHERE e.school_id=x.school_id AND e.deleted_at IS NULL AND lower(u.email)=lower(x.parent_email)
      AND lower(e.nom)=lower(x.enfant_nom) AND lower(e.prenom)=lower(x.enfant_prenom) AND e.date_naissance=x.date_naissance) AS enfant_existe
    FROM preinscriptions x WHERE x.school_id=$1`;
    if (req.query.statut) {
      p.push(String(req.query.statut));
      sql += ` AND x.statut=$${p.length}`;
    }
    return db.q(
      sql +
        " ORDER BY (x.statut='en_attente') DESC, x.created_at DESC LIMIT 500",
      p,
    );
  }),
);

// Le parent suit l'état de SES demandes, y compris dans d'autres écoles (retrouvées par son e-mail)
router.get(
  "/mes-preinscriptions",
  auth,
  allow("parent"),
  async (req, res, next) => {
    try {
      res.json(
        await tx({ bypass: true }, (db) =>
          db.q(
            `SELECT x.id,x.statut,x.enfant_nom,x.enfant_prenom,x.date_naissance,x.motif_refus,x.created_at,x.traite_le,
      (SELECT name FROM schools s WHERE s.id=x.school_id) AS ecole FROM preinscriptions x WHERE lower(x.parent_email)=lower($1) ORDER BY x.created_at DESC LIMIT 200`,
            [req.user.email],
          ),
        ),
      );
    } catch (e) {
      next(e);
    }
  },
);

async function autoClasse(db, annee, naissance) {
  const niveau = Math.min(
    6,
    Math.max(1, startYear(annee) - parseInt(naissance.slice(0, 4), 10) - 5),
  );
  return db.one(
    `SELECT c.id,c.niveau,c.section FROM classes c WHERE c.school_id=$1 AND c.annee_scolaire=$2 AND c.niveau=$3 AND c.deleted_at IS NULL
    AND (SELECT count(*) FROM eleves x WHERE x.classe_id=c.id AND x.deleted_at IS NULL) < c.capacite
    ORDER BY (SELECT count(*) FROM eleves x WHERE x.classe_id=c.id AND x.deleted_at IS NULL), c.section LIMIT 1`,
    [db.sid, annee, niveau],
  );
}
const APP_URL = () =>
  (process.env.APP_URL || "http://localhost:8090").replace(/\/$/, "");

router.post(
  "/preinscriptions/:id/valider",
  auth,
  allow("admin"),
  h(async (req, res, db) => {
    const pre = await db.find("preinscriptions", Number(req.params.id) || 0);
    if (!pre) throw new HttpError(404, "Introuvable");
    if (pre.statut !== "en_attente")
      throw new HttpError(409, "Cette demande a déjà été traitée");
    const annee = req.user.school.annee_courante,
      school = await db.one("SELECT name FROM schools WHERE id=$1", [db.sid]),
      ident = {};
    // 1) compte parent : créé UNE SEULE FOIS (retrouvé par e-mail dans l'école)
    let parent = await db.one(
      "SELECT id,role,actif FROM users WHERE school_id=$1 AND lower(email)=lower($2)",
      [db.sid, pre.parent_email],
    );
    if (parent && parent.role !== "parent")
      throw new HttpError(
        409,
        "Cette adresse e-mail appartient déjà à un compte non parent de l'école",
      );
    if (parent && !parent.actif)
      throw new HttpError(
        409,
        "Le compte de ce parent est désactivé : réactivez-le dans « Parents » avant de valider",
      );
    if (!parent) {
      const pwd = genPassword();
      parent = await db.insert("users", {
        email: pre.parent_email,
        password_hash: await bcrypt.hash(pwd, 10),
        role: "parent",
        nom: pre.parent_nom,
        prenom: pre.parent_prenom,
        telephone: pre.parent_telephone,
        mdp_temporaire: true,
      });
      ident.parent = { login: pre.parent_email, motdepasse: pwd };
      await audit(db, req.user, "AJOUT", "utilisateurs", parent.id, null, {
        email: pre.parent_email,
        role: "parent",
        origine: "pré-inscription #" + pre.id,
      });
    }
    // 2) élève : un enfant déjà inscrit (même parent, nom, prénom, naissance) est réutilisé, pas dupliqué
    let eleve = await db.one(
      `SELECT * FROM eleves WHERE school_id=$1 AND deleted_at IS NULL AND parent_id=$2 AND lower(nom)=lower($3) AND lower(prenom)=lower($4) AND date_naissance=$5`,
      [
        db.sid,
        parent.id,
        pre.enfant_nom,
        pre.enfant_prenom,
        pre.date_naissance,
      ],
    );
    const reinscription = !!eleve;
    if (!eleve) {
      let classe = null;
      if (req.body?.classe_id) {
        classe = await db.find("classes", Number(req.body.classe_id) || 0);
        if (!classe) throw new HttpError(400, "Classe introuvable");
      } else classe = await autoClasse(db, annee, pre.date_naissance);
      const data = await eleveBefore(
        db,
        {
          nom: pre.enfant_nom,
          prenom: pre.enfant_prenom,
          date_naissance: pre.date_naissance,
          sexe: pre.sexe,
          adresse: pre.adresse,
          antecedents_medicaux: pre.antecedents_medicaux,
          statut: "inscrit",
          classe_id: classe?.id || null,
          parent_id: parent.id,
          user_id: null,
          annee_entree: null,
          matricule: null,
        },
        req,
        null,
      );
      eleve = await db.insert("eleves", data);
      await audit(db, req.user, "AJOUT", "eleves", eleve.id, null, {
        ...data,
        origine: "pré-inscription #" + pre.id,
      });
    }
    // 3) compte élève : créé UNE SEULE FOIS, automatiquement
    if (!eleve.user_id) {
      const pwd = genPassword(),
        login = `${eleve.matricule.toLowerCase()}.${db.sid}@eleve.local`;
      const u = await db.insert("users", {
        email: login,
        password_hash: await bcrypt.hash(pwd, 10),
        role: "eleve",
        nom: eleve.nom,
        prenom: eleve.prenom,
        mdp_temporaire: true,
      });
      await db.update("eleves", eleve.id, { user_id: u.id });
      ident.eleve = { login, motdepasse: pwd };
      await audit(db, req.user, "AJOUT", "utilisateurs", u.id, null, {
        email: login,
        role: "eleve",
        origine: "pré-inscription #" + pre.id,
      });
    }
    await db.update("preinscriptions", pre.id, {
      statut: "validee",
      eleve_id: eleve.id,
      traite_par: req.user.id,
      traite_le: new Date(),
    });
    await audit(
      db,
      req.user,
      "VALIDATION",
      "preinscriptions",
      pre.id,
      { statut: "en_attente" },
      { statut: "validee", eleve_id: eleve.id },
    );
    // 4) e-mail au parent (identifiants uniquement pour les comptes qui viennent d'être créés)
    const lignes = [
      `Bonjour ${pre.parent_prenom} ${pre.parent_nom},`,
      "",
      `La pré-inscription de ${pre.enfant_prenom} ${pre.enfant_nom} à « ${school.name} » a été validée.`,
      "",
    ];
    if (ident.parent)
      lignes.push(
        "Votre compte parent :",
        `  Identifiant : ${ident.parent.login}`,
        `  Mot de passe temporaire : ${ident.parent.motdepasse}`,
        "",
      );
    else
      lignes.push(
        "Vous utilisez votre compte parent existant (même identifiant et mot de passe).",
        "",
      );
    if (ident.eleve)
      lignes.push(
        `Compte de ${pre.enfant_prenom} (élève) :`,
        `  Identifiant : ${ident.eleve.login}`,
        `  Mot de passe temporaire : ${ident.eleve.motdepasse}`,
        "",
      );
    lignes.push(
      `Connexion : ${APP_URL()}`,
      "Pour votre sécurité, vous serez invité à changer le mot de passe temporaire à la première connexion.",
      "",
      `${school.name}`,
    );
    const email_statut = await sendEmail(
      db,
      parent.id,
      pre.parent_email,
      `Inscription validée — ${school.name}`,
      lignes.join("\n"),
    );
    const classe = eleve.classe_id
      ? await db.find("classes", eleve.classe_id)
      : null;
    return {
      ok: true,
      reinscription,
      parent_nouveau: !!ident.parent,
      identifiants: ident,
      email: pre.parent_email,
      email_statut,
      url: APP_URL(),
      eleve: {
        id: eleve.id,
        nom: eleve.nom,
        prenom: eleve.prenom,
        matricule: eleve.matricule,
        classe: classe ? classLabel(classe) : null,
      },
    };
  }),
);

router.post(
  "/preinscriptions/:id/refuser",
  auth,
  allow("admin"),
  h(async (req, res, db) => {
    const pre = await db.find("preinscriptions", Number(req.params.id) || 0);
    if (!pre) throw new HttpError(404, "Introuvable");
    if (pre.statut !== "en_attente")
      throw new HttpError(409, "Cette demande a déjà été traitée");
    const d = await check(
      req.body || {},
      {
        motif: {
          type: "str",
          min: 3,
          max: 300,
          req: true,
          label: "Motif du refus",
        },
      },
      db,
    );
    await db.update("preinscriptions", pre.id, {
      statut: "refusee",
      motif_refus: d.motif,
      traite_par: req.user.id,
      traite_le: new Date(),
    });
    await audit(
      db,
      req.user,
      "REFUS",
      "preinscriptions",
      pre.id,
      { statut: "en_attente" },
      { statut: "refusee", motif: d.motif },
    );
    const school = await db.one("SELECT name FROM schools WHERE id=$1", [
      db.sid,
    ]);
    const email_statut = await sendEmail(
      db,
      null,
      pre.parent_email,
      `Pré-inscription non retenue — ${school.name}`,
      `Bonjour ${pre.parent_prenom} ${pre.parent_nom},\n\nNous ne pouvons pas donner suite à la pré-inscription de ${pre.enfant_prenom} ${pre.enfant_nom}.\nMotif : ${d.motif}\n\n${school.name}`,
    );
    return { ok: true, email_statut };
  }),
);

module.exports = router;
