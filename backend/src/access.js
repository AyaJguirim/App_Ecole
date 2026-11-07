// Règles d'accès par rôle (qui voit quoi). Tout est borné à l'école via db.sid.
const { HttpError } = require('./db');

const teacherClasses = `SELECT id FROM classes WHERE enseignant_id=? AND school_id=? AND deleted_at IS NULL
  UNION SELECT classe_id FROM affectations WHERE enseignant_id=? AND school_id=?`;

// Fragment SQL (avec ?) limitant les lignes ayant une colonne classe_id
function classScope(req, db, col = 'x.classe_id') {
  const u = req.user, s = db.sid;
  if (u.role === 'admin') return null;
  if (u.role === 'enseignant') return [`${col} IN (${teacherClasses})`, [u.id, s, u.id, s]];
  if (u.role === 'parent') return [`${col} IN (SELECT classe_id FROM eleves WHERE parent_id=? AND school_id=? AND deleted_at IS NULL AND classe_id IS NOT NULL)`, [u.id, s]];
  if (u.role === 'eleve') return [`${col} IN (SELECT classe_id FROM eleves WHERE user_id=? AND school_id=? AND deleted_at IS NULL AND classe_id IS NOT NULL)`, [u.id, s]];
  return ['FALSE', []];
}
// Fragment SQL limitant les lignes ayant une colonne eleve_id
function eleveScope(req, db, col = 'x.eleve_id') {
  const u = req.user, s = db.sid;
  if (u.role === 'admin' || u.role === 'comptable') return null;
  if (u.role === 'enseignant') return [`${col} IN (SELECT id FROM eleves WHERE school_id=? AND deleted_at IS NULL AND classe_id IN (${teacherClasses}))`, [s, u.id, s, u.id, s]];
  if (u.role === 'parent') return [`${col} IN (SELECT id FROM eleves WHERE parent_id=? AND school_id=? AND deleted_at IS NULL)`, [u.id, s]];
  if (u.role === 'eleve') return [`${col} IN (SELECT id FROM eleves WHERE user_id=? AND school_id=? AND deleted_at IS NULL)`, [u.id, s]];
  return ['FALSE', []];
}
async function canSeeEleve(req, db, eleveId) {
  const s = eleveScope(req, db, 'x.id');
  const r = await db.one(`SELECT x.id FROM eleves x WHERE x.id=$1 AND x.school_id=$2 AND x.deleted_at IS NULL` + (s ? ' AND ' + numbered(s, 2)[0] : ''), [eleveId, db.sid, ...(s ? s[1] : [])]);
  return !!r;
}
async function mustSeeEleve(req, db, id) {
  id = Number(id);
  if (!Number.isInteger(id) || !(await canSeeEleve(req, db, id))) throw new HttpError(404, 'Introuvable');
  return db.find('eleves', id);
}
// convertit les ? en $n à partir de l'offset
function numbered(s, offset) { let i = offset; return [s[0].replace(/\?/g, () => '$' + (++i)), s[1]]; }
// une classe est-elle enseignée par ce professeur ?
async function teachesClass(db, userId, classeId, matiereId) {
  if (matiereId) return !!(await db.one('SELECT 1 FROM affectations WHERE school_id=$1 AND enseignant_id=$2 AND classe_id=$3 AND matiere_id=$4', [db.sid, userId, classeId, matiereId]));
  return !!(await db.one('SELECT 1 FROM classes WHERE id=$1 AND school_id=$2 AND enseignant_id=$3 UNION SELECT 1 FROM affectations WHERE classe_id=$1 AND school_id=$2 AND enseignant_id=$3', [classeId, db.sid, userId]));
}
const niveauLabel = n => (n === 1 ? '1ère année' : `${n}ème année`);
const classLabel = c => `${niveauLabel(c.niveau)} ${c.section}`;

module.exports = { classScope, eleveScope, canSeeEleve, mustSeeEleve, numbered, teachesClass, niveauLabel, classLabel };
