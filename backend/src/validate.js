// Contrôles de saisie côté serveur (source de vérité). Le front applique les mêmes limites.
const { HttpError } = require('./db');

const NAME_RE = /^[\p{L}][\p{L} '’.-]*$/u;
const TEL_RE = /^\+?[0-9][0-9 ]{7,17}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const bad = m => { throw new Error(m); };

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
const today = () => new Date().toISOString().slice(0, 10);
const startYear = annee => parseInt(String(annee).slice(0, 4), 10);

async function conv(v, f, db) {
  switch (f.type) {
    case 'str': case 'name': case 'email': case 'tel': {
      v = String(v).trim().replace(/\s+/g, ' ');
      const min = f.min ?? (f.type === 'name' ? 2 : 1), max = f.max ?? (f.type === 'name' ? 60 : 255);
      if (v.length < min) bad(`au moins ${min} caractère(s)`);
      if (v.length > max) bad(`${max} caractères maximum`);
      if (f.type === 'name' && !NAME_RE.test(v)) bad('lettres, espaces, apostrophes et tirets uniquement');
      if (f.type === 'email') { v = v.toLowerCase(); if (!EMAIL_RE.test(v)) bad('adresse e-mail invalide'); }
      if (f.type === 'tel' && !TEL_RE.test(v)) bad('numéro de téléphone invalide (8 à 15 chiffres)');
      if (f.pattern && !f.pattern.test(v)) bad(f.patternMsg || 'format invalide');
      return v;
    }
    case 'int': case 'num': {
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n)) bad('nombre invalide');
      if (f.type === 'int' && !Number.isInteger(n)) bad('nombre entier attendu');
      if (f.min !== undefined && n < f.min) bad(`minimum ${f.min}`);
      if (f.max !== undefined && n > f.max) bad(`maximum ${f.max}`);
      return n;
    }
    case 'date': {
      v = String(v).slice(0, 10);
      if (!validDate(v)) bad('date invalide (AAAA-MM-JJ)');
      if (f.noFuture && v > today()) bad('la date ne peut pas être dans le futur');
      if (f.min && v < f.min) bad(`la date doit être postérieure ou égale au ${f.min}`);
      return v;
    }
    case 'time': {
      const m = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/.exec(String(v));
      if (!m) bad('heure invalide (HH:MM)');
      return `${m[1]}:${m[2]}`;
    }
    case 'enum': if (!f.values.includes(v)) bad(`valeur autorisée : ${f.values.join(', ')}`); return v;
    case 'bool': return v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
    case 'annee': {
      const m = /^(\d{4})-(\d{4})$/.exec(String(v));
      if (!m || +m[2] !== +m[1] + 1 || +m[1] < 2000 || +m[1] > 2100) bad('format attendu : 2026-2027');
      return v;
    }
    case 'ref': {
      const id = Number(v);
      if (!Number.isInteger(id) || id <= 0) bad('référence invalide');
      const row = await db.find(f.table, id);               // la ligne doit exister DANS L'ÉCOLE
      if (!row) bad('élément introuvable');
      if (f.role && row.role !== f.role) bad(`doit être un compte « ${f.role} »`);
      return id;
    }
    default: return v;
  }
}

async function check(body, schema, db) {
  const out = {}, errs = [];
  for (const [k, f] of Object.entries(schema)) {
    const v = body[k], label = f.label || k;
    if (v === undefined || v === null || v === '') {
      if (f.req && f.def === undefined) errs.push(`${label} est obligatoire`);
      else out[k] = f.def !== undefined ? f.def : null;
      continue;
    }
    try { out[k] = await conv(v, f, db); } catch (e) { errs.push(`${label} : ${e.message}`); }
  }
  if (errs.length) throw new HttpError(400, errs.join(' ; '));
  return out;
}

function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 8 || p.length > 72 || !/[A-Za-z]/.test(p) || !/\d/.test(p))
    throw new HttpError(400, 'Mot de passe : 8 caractères minimum, avec au moins une lettre et un chiffre');
  return p;
}

// Règles d'âge : un élève de 1ère année a 6 ans dans l'année civile de la rentrée (né en 2020 pour 2026-2027).
// Niveau n : né en (S-5-n) ou avant ; retard maximum toléré : 3 ans. Âge maximum global : 14 ans (né en S-14 ou après).
function ageBounds(annee, niveau) {
  const S = startYear(annee), n = niveau || 1;
  return { maxYear: S - 5 - n, minYear: Math.max(S - 14, S - 5 - n - 3) };
}
function checkNaissance(dateNaissance, annee, niveau) {
  const y = parseInt(dateNaissance.slice(0, 4), 10), { maxYear, minYear } = ageBounds(annee, niveau);
  const S = startYear(annee);
  if (y > maxYear) throw new HttpError(400, niveau
    ? `Date de naissance : un élève de ${niveau === 1 ? '1ère' : niveau + 'ème'} année doit être né en ${maxYear} ou avant (année scolaire ${annee})`
    : `Date de naissance : l'âge minimum est de 6 ans (né en ${S - 6} ou avant pour l'année ${annee})`);
  if (y < minYear) throw new HttpError(400, `Date de naissance : élève trop âgé pour ce niveau (né en ${minYear} ou après requis ; âge maximum 14 ans)`);
}

module.exports = { check, checkPassword, checkNaissance, ageBounds, startYear, today, validDate };
