const express = require('express');
const { HttpError, audit } = require('../db');
const { auth, allow, h } = require('../auth');
const { check, today } = require('../validate');
const { classScope, eleveScope, canSeeEleve, teachesClass, numbered } = require('../access');
const { notify } = require('../notify');
const { upload, saveFile, devoirVisible } = require('../files');
const crud = require('../crud');
const router = express.Router();
const TEACH = ['admin', 'enseignant'];

async function classUsers(db, classeId) {
  const r = await db.q('SELECT user_id,parent_id FROM eleves WHERE school_id=$1 AND classe_id=$2 AND deleted_at IS NULL', [db.sid, classeId]);
  return r.flatMap(x => [x.user_id, x.parent_id]);
}
async function ownDevoir(req, db, id) {
  const d = await devoirVisible(req, db, Number(id) || 0);
  if (!d || (req.user.role === 'enseignant' && d.enseignant_id !== req.user.id)) throw new HttpError(404, 'Introuvable');
  return d;
}

crud(router, 'devoirs', {
  table: 'devoirs', read: ['admin', 'enseignant', 'parent', 'eleve'], write: TEACH, filters: ['classe_id', 'matiere_id'], order: 'x.date_remise DESC, x.id DESC',
  scope: (req, db) => classScope(req, db),
  cols: `x.id,x.classe_id,x.matiere_id,x.enseignant_id,x.titre,x.description,x.date_remise,x.bareme,x.pieces,x.created_at,
    (x.correction_id IS NOT NULL AND x.date_remise < CURRENT_DATE) AS correction_dispo,(x.correction_id IS NOT NULL) AS a_correction,x.correction_id,
    (SELECT niveau FROM classes c WHERE c.id=x.classe_id) AS classe_niveau,(SELECT section FROM classes c WHERE c.id=x.classe_id) AS classe_section,
    (SELECT nom FROM matieres m WHERE m.id=x.matiere_id) AS matiere,(SELECT nom||' '||prenom FROM users u WHERE u.id=x.enseignant_id) AS enseignant,
    (SELECT count(*)::int FROM depots d WHERE d.devoir_id=x.id) AS nb_depots`,
  schema: {
    classe_id: { type: 'ref', table: 'classes', req: true, label: 'Classe' }, matiere_id: { type: 'ref', table: 'matieres', req: true, label: 'Matière' },
    titre: { type: 'str', min: 3, max: 150, req: true, label: 'Titre' }, description: { type: 'str', max: 5000, label: 'Description' },
    date_remise: { type: 'date', req: true, label: 'Date de remise' }, bareme: { type: 'num', min: 1, max: 100, def: 20, label: 'Barème' },
  },
  async guard(req, db, old) { if (old && req.user.role === 'enseignant' && old.enseignant_id !== req.user.id) throw new HttpError(403, 'Ce devoir appartient à un autre enseignant'); },
  async before(db, d, req, old) {
    if (!old || d.date_remise !== old.date_remise) if (d.date_remise < today()) throw new HttpError(400, 'Date de remise : ne peut pas être dans le passé');
    if (req.user.role === 'enseignant') {
      if (!(await teachesClass(db, req.user.id, d.classe_id, d.matiere_id))) throw new HttpError(403, 'Vous n\'enseignez pas cette matière dans cette classe');
      d.enseignant_id = req.user.id;
    } else {
      const a = await db.one('SELECT enseignant_id FROM affectations WHERE school_id=$1 AND classe_id=$2 AND matiere_id=$3 LIMIT 1', [db.sid, d.classe_id, d.matiere_id]);
      if (!a) throw new HttpError(400, 'Aucun enseignant affecté à cette matière dans cette classe');
      d.enseignant_id = old?.enseignant_id || a.enseignant_id;
    }
    if (old) {
      if (old.classe_id !== d.classe_id && old.nb_depots) throw new HttpError(400, 'Classe non modifiable : des travaux sont déjà déposés');
      const mx = (await db.one('SELECT COALESCE(max(note),0) m FROM depots WHERE devoir_id=$1 AND school_id=$2', [old.id, db.sid])).m;
      if (d.bareme < mx) throw new HttpError(400, `Barème : une note de ${mx} a déjà été attribuée`);
    }
  },
  async after(db, row, req, isNew) {
    if (isNew) await notify(db, await classUsers(db, row.classe_id), 'Nouveau devoir', `${row.titre} — à rendre pour le ${row.date_remise.split('-').reverse().join('/')}`, '#/devoirs');
  },
  async beforeDelete(db, old, req) {
    const n = (await db.one('SELECT count(*)::int n FROM depots WHERE devoir_id=$1 AND school_id=$2', [old.id, db.sid])).n;
    if (n && req.query.force !== '1') throw new HttpError(409, `${n} travail(aux) déjà déposé(s) : confirmez la suppression pour tout effacer.`);
    await db.q('DELETE FROM depots WHERE devoir_id=$1 AND school_id=$2', [old.id, db.sid]);
  },
});

router.post('/devoirs/:id/pieces', auth, allow(...TEACH), upload.array('fichiers', 5), h(async (req, res, db) => {
  const d = await ownDevoir(req, db, req.params.id);
  if (!req.files?.length) throw new HttpError(400, 'Aucun fichier');
  if (d.pieces.length + req.files.length > 8) throw new HttpError(400, '8 pièces jointes maximum');
  const pieces = [...d.pieces];
  for (const f of req.files) { const s = await saveFile(db, req.user, f, 'devoir', d.id); pieces.push({ id: s.id, nom: s.nom }); }
  await db.q('UPDATE devoirs SET pieces=$3 WHERE id=$1 AND school_id=$2', [d.id, db.sid, JSON.stringify(pieces)]);
  await audit(db, req.user, 'MODIF', 'devoirs', d.id, null, { pieces: pieces.map(p => p.nom) });
  return { pieces };
}));
router.delete('/devoirs/:id/pieces/:fid', auth, allow(...TEACH), h(async (req, res, db) => {
  const d = await ownDevoir(req, db, req.params.id);
  await db.q('UPDATE devoirs SET pieces=$3 WHERE id=$1 AND school_id=$2', [d.id, db.sid, JSON.stringify(d.pieces.filter(p => p.id !== req.params.fid))]);
  return { ok: true };
}));
router.post('/devoirs/:id/correction', auth, allow(...TEACH), upload.single('fichier'), h(async (req, res, db) => {
  const d = await ownDevoir(req, db, req.params.id);
  if (!req.file) throw new HttpError(400, 'Fichier manquant');
  const f = await saveFile(db, req.user, req.file, 'correction', d.id);
  await db.q('UPDATE devoirs SET correction_id=$3 WHERE id=$1 AND school_id=$2', [d.id, db.sid, f.id]);
  await audit(db, req.user, 'MODIF', 'devoirs', d.id, null, { correction: f.nom });
  await notify(db, await classUsers(db, d.classe_id), 'Correction disponible', `${d.titre} — visible après le ${d.date_remise.split('-').reverse().join('/')}`, '#/devoirs');
  return { ok: true };
}));

// Dépôts d'un devoir : enseignant = tous les élèves de la classe ; élève / parent = les leurs
router.get('/devoirs/:id/depots', auth, h(async (req, res, db) => {
  const d = await devoirVisible(req, db, Number(req.params.id) || 0);
  if (!d || (req.user.role === 'enseignant' && d.enseignant_id !== req.user.id)) throw new HttpError(404, 'Introuvable');
  if (req.user.role === 'comptable') throw new HttpError(403, 'Accès refusé');
  const p = [db.sid, d.classe_id, d.id]; let sql = `SELECT el.id AS eleve_id,el.nom,el.prenom,dp.id AS depot_id,dp.date_depot,dp.fichiers,dp.note,dp.commentaire,dp.vu_parent
    FROM eleves el LEFT JOIN depots dp ON dp.eleve_id=el.id AND dp.devoir_id=$3 AND dp.school_id=el.school_id
    WHERE el.school_id=$1 AND el.classe_id=$2 AND el.deleted_at IS NULL`;
  const s = eleveScope(req, db, 'el.id'); if (s) { const [f, ps] = numbered(s, 3); sql += ' AND ' + f; p.push(...ps); }
  const rows = await db.q(sql + ' ORDER BY el.nom,el.prenom', p), t = today();
  return { devoir: d, depots: rows.map(r => ({ ...r, statut: !r.depot_id ? (d.date_remise < t ? 'non_rendu' : 'a_rendre') : (r.date_depot.toISOString().slice(0, 10) > d.date_remise ? 'en_retard' : 'rendu') + (r.note != null ? '_note' : '') })) };
}));

router.post('/devoirs/:id/depot', auth, allow('eleve'), upload.array('fichiers', 3), h(async (req, res, db) => {
  const d = await devoirVisible(req, db, Number(req.params.id) || 0);
  if (!d) throw new HttpError(404, 'Introuvable');
  const el = await db.one('SELECT id FROM eleves WHERE school_id=$1 AND user_id=$2 AND classe_id=$3 AND deleted_at IS NULL', [db.sid, req.user.id, d.classe_id]);
  if (!el) throw new HttpError(404, 'Introuvable');
  if (!req.files?.length) throw new HttpError(400, 'Joignez au moins un fichier (3 maximum)');
  const old = await db.one('SELECT * FROM depots WHERE devoir_id=$1 AND eleve_id=$2 AND school_id=$3', [d.id, el.id, db.sid]);
  if (old && d.date_remise < today()) throw new HttpError(400, 'La date de remise est dépassée : le dépôt ne peut plus être remplacé');
  if (old && old.note != null) throw new HttpError(400, 'Ce travail est déjà noté : remplacement impossible');
  const dep = old ? await db.one('UPDATE depots SET date_depot=now(),vu_parent=false WHERE id=$1 AND school_id=$2 RETURNING *', [old.id, db.sid])
    : await db.insert('depots', { devoir_id: d.id, eleve_id: el.id });
  const fichiers = [];
  for (const f of req.files) { const s = await saveFile(db, req.user, f, 'depot', dep.id); fichiers.push({ id: s.id, nom: s.nom }); }
  await db.q('UPDATE depots SET fichiers=$3 WHERE id=$1 AND school_id=$2', [dep.id, db.sid, JSON.stringify(fichiers)]);
  await audit(db, req.user, old ? 'MODIF' : 'AJOUT', 'depots', dep.id, null, { devoir: d.id, fichiers: fichiers.map(f => f.nom) });
  await notify(db, [d.enseignant_id], 'Travail déposé', `${req.user.prenom} ${req.user.nom} a rendu « ${d.titre} »`, '#/devoirs');
  res.status(201); return { ok: true, en_retard: d.date_remise < today() };
}));

router.put('/depots/:id/noter', auth, allow(...TEACH), h(async (req, res, db) => {
  const dep = await db.find('depots', Number(req.params.id) || 0);
  if (!dep) throw new HttpError(404, 'Introuvable');
  const d = await ownDevoir(req, db, dep.devoir_id);
  const v = await check(req.body || {}, { note: { type: 'num', min: 0, max: d.bareme, req: true, label: `Note (0 à ${d.bareme})` }, commentaire: { type: 'str', max: 500, label: 'Commentaire' } }, db);
  await db.update('depots', dep.id, { note: v.note, commentaire: v.commentaire });
  await audit(db, req.user, 'MODIF', 'depots', dep.id, { note: dep.note, commentaire: dep.commentaire }, v);
  const el = await db.find('eleves', dep.eleve_id);
  await notify(db, [el.user_id, el.parent_id], 'Devoir noté', `${d.titre} : ${v.note}/${d.bareme}`, '#/devoirs');
  return { ok: true };
}));
router.post('/depots/:id/vu', auth, allow('parent'), h(async (req, res, db) => {
  const dep = await db.find('depots', Number(req.params.id) || 0);
  if (!dep || !(await canSeeEleve(req, db, dep.eleve_id))) throw new HttpError(404, 'Introuvable');
  await db.update('depots', dep.id, { vu_parent: true });
  return { ok: true };
}));

module.exports = router;
