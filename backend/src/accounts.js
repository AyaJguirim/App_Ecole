// Création de comptes parent / élève et envoi des identifiants.
const crypto = require("crypto");
const { HttpError, audit } = require("./db");
const { bcrypt } = require("./auth");
const { check } = require("./validate");
const { sendEmail } = require("./notify");

const APP_URL = () =>
  (process.env.APP_URL || "http://localhost:8080").replace(/\/$/, "");

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

const PARENT_SCHEMA = {
  nom: { type: "name", req: true, label: "Nom du parent" },
  prenom: { type: "name", req: true, label: "Prénom du parent" },
  email: { type: "email", req: true, label: "E-mail du parent", max: 200 },
  telephone: { type: "tel", req: true, label: "Téléphone du parent" },
};

// Crée le parent, ou réutilise celui qui a déjà cet e-mail dans l'école
async function ensureParent(db, req, body) {
  const p = await check(body || {}, PARENT_SCHEMA, db);
  const ex = await db.one(
    "SELECT id,role,actif FROM users WHERE school_id=$1 AND lower(email)=lower($2)",
    [db.sid, p.email],
  );
  if (ex) {
    if (ex.role !== "parent")
      throw new HttpError(
        409,
        "Cette adresse e-mail appartient déjà à un compte non parent de l'école",
      );
    if (!ex.actif)
      throw new HttpError(
        409,
        "Le compte de ce parent est désactivé : réactivez-le dans « Parents »",
      );
    return { id: ex.id, nouveau: false };
  }
  const pwd = genPassword();
  const u = await db.insert("users", {
    email: p.email,
    password_hash: await bcrypt.hash(pwd, 10),
    role: "parent",
    nom: p.nom,
    prenom: p.prenom,
    telephone: p.telephone,
    mdp_temporaire: true,
  });
  await audit(db, req.user, "AJOUT", "utilisateurs", u.id, null, {
    email: p.email,
    role: "parent",
    origine: "création depuis le formulaire élève",
  });
  return { id: u.id, nouveau: true, login: p.email, motdepasse: pwd };
}

// Crée le compte élève (mot de passe temporaire) et l'associe au dossier
async function createEleveAccount(db, req, eleve) {
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
  await audit(db, req.user, "AJOUT", "utilisateurs", u.id, null, {
    email: login,
    role: "eleve",
    origine: "création automatique du compte élève",
  });
  return { login, motdepasse: pwd };
}

// Crée ce qui manque et envoie UN e-mail au parent avec les identifiants. Retourne le résumé pour l'interface.
async function provision(db, req, eleve, parentIdent, needEleveAccount) {
  const ident = {};
  if (parentIdent?.nouveau)
    ident.parent = {
      login: parentIdent.login,
      motdepasse: parentIdent.motdepasse,
    };
  if (needEleveAccount) ident.eleve = await createEleveAccount(db, req, eleve);
  if (!ident.parent && !ident.eleve) return null;
  const out = {
    identifiants: ident,
    email: null,
    email_statut: "aucun_parent",
  };
  if (eleve.parent_id) {
    const parent = await db.find("users", eleve.parent_id),
      school = await db.one("SELECT name FROM schools WHERE id=$1", [db.sid]);
    const L = [
      `Bonjour ${parent.prenom} ${parent.nom},`,
      "",
      `${eleve.prenom} ${eleve.nom} (matricule ${eleve.matricule}) est inscrit(e) à « ${school.name} ».`,
      "",
    ];
    if (ident.parent)
      L.push(
        "Votre compte parent :",
        `  Identifiant : ${ident.parent.login}`,
        `  Mot de passe temporaire : ${ident.parent.motdepasse}`,
        "",
      );
    else
      L.push(
        "Vous utilisez votre compte parent existant (même identifiant et mot de passe).",
        "",
      );
    if (ident.eleve)
      L.push(
        `Compte de ${eleve.prenom} (élève) :`,
        `  Identifiant : ${ident.eleve.login}`,
        `  Mot de passe temporaire : ${ident.eleve.motdepasse}`,
        "",
      );
    L.push(
      `Connexion : ${APP_URL()}`,
      "Un nouveau mot de passe sera demandé à la première connexion (parent et élève).",
      "",
      school.name,
    );
    out.email = parent.email;
    out.email_statut = await sendEmail(
      db,
      parent.id,
      parent.email,
      `Identifiants de connexion — ${school.name}`,
      L.join("\n"),
    );
  }
  return out;
}
module.exports = { genPassword, ensureParent, provision };
