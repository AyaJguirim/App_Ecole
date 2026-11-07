const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { tx, HttpError } = require('./db');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) { console.error('JWT_SECRET manquant ou trop court (.env)'); process.exit(1); }

const signToken = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '8h' });

const USER_SQL = `SELECT u.id,u.school_id,u.email,u.role,u.nom,u.prenom,u.telephone,u.mdp_temporaire,u.actif,u.password_hash,
  s.name AS school_name,s.status AS school_status,s.subscription_end,s.annee_courante
  FROM users u LEFT JOIN schools s ON s.id=u.school_id`;

function checkSchool(u) {
  if (u.role === 'superadmin') return;
  if (u.school_status === 'suspended') throw new HttpError(403, 'Cette école est suspendue. Contactez le support.');
  if (u.subscription_end && u.subscription_end < new Date().toISOString().slice(0, 10))
    throw new HttpError(403, 'L\'abonnement de cette école a expiré. Contactez le support.');
}
const publicUser = u => ({
  id: u.id, nom: u.nom, prenom: u.prenom, role: u.role, email: u.email, telephone: u.telephone, mdp_temporaire: u.mdp_temporaire,
  school: u.school_id ? { id: u.school_id, name: u.school_name, annee_courante: u.annee_courante, status: u.school_status } : null,
});

// Un même e-mail peut exister dans plusieurs écoles (parent ayant des enfants dans 2 écoles) :
// le mot de passe désigne le compte ; si les deux correspondent, l'utilisateur choisit son école.
async function login(email, password, schoolId) {
  const rows = await tx({ bypass: true }, db => db.q(USER_SQL + ' WHERE lower(u.email)=lower($1)', [String(email || '')]));
  const dummy = '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
  const ok = [];
  for (const u of rows.length ? rows : [{ password_hash: dummy }]) if ((await bcrypt.compare(String(password || ''), u.password_hash)) && u.actif && u.id) ok.push(u);
  if (!ok.length) throw new HttpError(401, 'E-mail ou mot de passe incorrect');
  let u = ok[0];
  if (ok.length > 1) {
    u = ok.find(x => x.school_id === Number(schoolId));
    if (!u) return { choix_ecole: ok.map(x => ({ id: x.school_id, name: x.school_name || 'Plateforme' })) };
  }
  checkSchool(u);
  return { token: signToken(u), user: publicUser(u) };
}

// L'école vient TOUJOURS du serveur (jeton signé + base), jamais d'un paramètre du navigateur.
async function auth(req, res, next) {
  try {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) throw new HttpError(401, 'Authentification requise');
    let payload;
    try { payload = jwt.verify(m[1], SECRET); } catch { throw new HttpError(401, 'Session expirée, reconnectez-vous'); }
    const u = await tx({ bypass: true }, db => db.one(USER_SQL + ' WHERE u.id=$1', [payload.id]));
    if (!u || !u.actif) throw new HttpError(401, 'Compte désactivé');
    checkSchool(u);
    req.user = { id: u.id, role: u.role, schoolId: u.school_id, nom: u.nom, prenom: u.prenom, email: u.email, school: { name: u.school_name, annee_courante: u.annee_courante }, pub: publicUser(u) };
    next();
  } catch (e) { next(e); }
}

const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, 'Accès refusé : droits insuffisants'));

// Enveloppe de route : transaction scopée sur l'école de l'utilisateur connecté.
const h = fn => async (req, res, next) => {
  try {
    const ctx = req.user.role === 'superadmin' ? { bypass: true } : { schoolId: req.user.schoolId };
    const out = await tx(ctx, db => fn(req, res, db));
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) { next(e); }
};

module.exports = { login, auth, allow, h, bcrypt, publicUser, USER_SQL };
