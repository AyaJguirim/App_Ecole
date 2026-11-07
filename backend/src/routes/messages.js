const express = require('express');
const { HttpError, audit } = require('../db');
const { auth, allow, h } = require('../auth');
const { check } = require('../validate');
const { notify } = require('../notify');
const router = express.Router();

// Qui peut écrire à qui (RBAC de la messagerie)
async function allowed(db, u) {
  const s = db.sid, me = u.id;
  const staff = role => db.q(`SELECT id,nom,prenom,role,NULL::int AS eleve_id,NULL AS eleve FROM users WHERE school_id=$1 AND actif AND id<>$2 AND role = ANY($3)`, [s, me, role]);
  if (u.role === 'admin') return staff(['admin', 'comptable', 'enseignant', 'parent', 'eleve']);
  if (u.role === 'comptable') {   // direction + parents avec lesquels une conversation existe déjà (pas de liste des comptes)
    const talked = await db.q(`SELECT u.id,u.nom,u.prenom,u.role,NULL::int AS eleve_id,NULL AS eleve FROM users u WHERE u.school_id=$1 AND u.actif AND u.role='parent' AND (
      EXISTS (SELECT 1 FROM messages m JOIN message_destinataires d ON d.message_id=m.id WHERE m.expediteur_id=$2 AND d.destinataire_id=u.id AND m.statut='envoye')
      OR EXISTS (SELECT 1 FROM messages m JOIN message_destinataires d ON d.message_id=m.id WHERE m.expediteur_id=u.id AND d.destinataire_id=$2 AND m.statut='envoye'))`, [s, me]);
    return [...talked, ...(await staff(['admin']))];
  }
  if (u.role === 'eleve') return staff(['admin']);
  if (u.role === 'enseignant') {
    const parents = await db.q(`SELECT u.id,u.nom,u.prenom,'parent' AS role,e.id AS eleve_id,e.prenom||' '||e.nom AS eleve FROM eleves e JOIN users u ON u.id=e.parent_id AND u.actif
      WHERE e.school_id=$1 AND e.deleted_at IS NULL AND e.classe_id IN (SELECT id FROM classes WHERE enseignant_id=$2 AND school_id=$1 AND deleted_at IS NULL UNION SELECT classe_id FROM affectations WHERE enseignant_id=$2 AND school_id=$1)`, [s, me]);
    return [...parents, ...(await staff(['admin']))];
  }
  const teachers = await db.q(`SELECT u.id,u.nom,u.prenom,'enseignant' AS role,e.id AS eleve_id,e.prenom||' '||e.nom AS eleve FROM eleves e
    JOIN users u ON u.school_id=e.school_id AND u.actif AND u.role='enseignant' AND (u.id IN (SELECT enseignant_id FROM affectations a WHERE a.classe_id=e.classe_id AND a.school_id=e.school_id)
      OR u.id IN (SELECT enseignant_id FROM classes c WHERE c.id=e.classe_id AND c.enseignant_id IS NOT NULL))
    WHERE e.parent_id=$2 AND e.school_id=$1 AND e.deleted_at IS NULL`, [s, me]);
  return [...teachers, ...(await staff(['admin', 'comptable']))];
}

router.get('/messages/destinataires', auth, allow('admin', 'comptable', 'enseignant', 'parent', 'eleve'), h((req, res, db) => allowed(db, req.user)));

const SEL = `SELECT m.id,m.type,m.objet,m.statut,m.cible,m.created_at,m.sent_at,m.eleve_id,m.expediteur_id,
  (SELECT nom||' '||prenom FROM users u WHERE u.id=m.expediteur_id) AS expediteur,(SELECT prenom||' '||nom FROM eleves e WHERE e.id=m.eleve_id) AS eleve,
  left(m.corps,120) AS extrait`;
router.get('/messages', auth, allow('admin', 'comptable', 'enseignant', 'parent', 'eleve'), h(async (req, res, db) => {
  const u = req.user, d = req.query.dossier || 'recus', p = [db.sid, u.id];
  if (d === 'recus') return db.q(`${SEL},dd.lu FROM messages m JOIN message_destinataires dd ON dd.message_id=m.id AND dd.school_id=m.school_id
    WHERE m.school_id=$1 AND dd.destinataire_id=$2 AND dd.masque=false AND m.statut='envoye' AND m.type='message' ORDER BY m.sent_at DESC LIMIT 300`, p);
  if (d === 'envoyes') return db.q(`${SEL},true AS lu,(SELECT string_agg(u.nom||' '||u.prenom,', ') FROM message_destinataires dd JOIN users u ON u.id=dd.destinataire_id WHERE dd.message_id=m.id) AS destinataires
    FROM messages m WHERE m.school_id=$1 AND m.expediteur_id=$2 AND m.statut='envoye' AND m.type='message' ORDER BY m.sent_at DESC LIMIT 300`, p);
  if (d === 'brouillons') return db.q(`${SEL},true AS lu FROM messages m WHERE m.school_id=$1 AND m.expediteur_id=$2 AND m.statut='brouillon' ORDER BY m.created_at DESC`, p);
  if (d === 'annonces') {
    const cible = { parent: 'parents', enseignant: 'enseignants', eleve: 'eleves' }[u.role];
    return db.q(`${SEL},true AS lu FROM messages m WHERE m.school_id=$1 AND m.type='annonce' AND ($2='admin' OR m.cible='tous' OR m.cible=$3) ORDER BY m.sent_at DESC LIMIT 100`, [db.sid, u.role, cible || 'tous']);
  }
  throw new HttpError(400, 'Dossier inconnu');
}));

router.get('/messages/:id', auth, allow('admin', 'comptable', 'enseignant', 'parent', 'eleve'), h(async (req, res, db) => {
  const m = await db.find('messages', Number(req.params.id) || 0);
  if (!m) throw new HttpError(404, 'Introuvable');
  const dest = await db.q(`SELECT dd.destinataire_id,dd.lu,u.nom||' '||u.prenom AS nom FROM message_destinataires dd JOIN users u ON u.id=dd.destinataire_id WHERE dd.message_id=$1 AND dd.school_id=$2`, [m.id, db.sid]);
  const mine = dest.find(x => x.destinataire_id === req.user.id);
  const cible = { parent: 'parents', enseignant: 'enseignants', eleve: 'eleves' }[req.user.role];
  const visible = m.expediteur_id === req.user.id ||
    (m.type === 'annonce' && (req.user.role === 'admin' || m.cible === 'tous' || m.cible === cible)) ||
    (m.type === 'message' && m.statut === 'envoye' && mine);
  if (!visible) throw new HttpError(404, 'Introuvable');   // l'administration ne lit pas les messages des autres : parties concernées uniquement
  if (mine && !mine.lu) await db.q('UPDATE message_destinataires SET lu=true WHERE message_id=$1 AND destinataire_id=$2 AND school_id=$3', [m.id, req.user.id, db.sid]);
  await audit(db, req.user, 'CONSULTATION', 'messages', m.id, null, null);    // journalisation des accès à l'historique
  const exp = await db.one('SELECT nom,prenom,role FROM users WHERE id=$1 AND school_id=$2', [m.expediteur_id, db.sid]);
  const eleve = m.eleve_id ? await db.one('SELECT prenom,nom FROM eleves WHERE id=$1 AND school_id=$2', [m.eleve_id, db.sid]) : null;
  return { ...m, expediteur: exp, eleve, destinataires: m.expediteur_id === req.user.id ? dest : undefined, immuable: m.statut === 'envoye' };
}));

const SCHEMA = {
  objet: { type: 'str', min: 3, max: 150, req: true, label: 'Objet' }, corps: { type: 'str', min: 1, max: 5000, req: true, label: 'Message' },
  eleve_id: { type: 'ref', table: 'eleves', label: 'Élève concerné' },
};
async function persist(req, db, existing) {
  const b = req.body || {}, brouillon = b.brouillon === true || b.brouillon === 'true';
  const d = await check({ ...b, corps: String(b.corps ?? '').trim() }, SCHEMA, db);
  let ids = [...new Set((Array.isArray(b.destinataires) ? b.destinataires : []).map(Number))];
  if (ids.some(x => !Number.isInteger(x))) throw new HttpError(400, 'Destinataires invalides');
  const ok = new Map((await allowed(db, req.user)).map(a => [a.id, a]));
  if (ids.some(x => !ok.has(x))) throw new HttpError(403, 'Vous n\'êtes pas autorisé à écrire à l\'un de ces destinataires');
  if (!brouillon && !ids.length) throw new HttpError(400, 'Choisissez au moins un destinataire');
  if (ids.length > 300) throw new HttpError(400, '300 destinataires maximum');
  const pieces = [];
  for (const fid of (Array.isArray(b.pieces) ? b.pieces : []).slice(0, 5)) {
    const f = await db.one(`SELECT id,nom FROM fichiers WHERE id::text=$1 AND school_id=$2 AND uploaded_by=$3 AND contexte='message'`, [String(fid), db.sid, req.user.id]);
    if (!f) throw new HttpError(400, 'Pièce jointe invalide'); pieces.push({ id: f.id, nom: f.nom });
  }
  const row = { objet: d.objet, corps: d.corps, eleve_id: d.eleve_id, pieces: JSON.stringify(pieces), statut: brouillon ? 'brouillon' : 'envoye', sent_at: brouillon ? null : new Date() };
  let m;
  if (existing) { m = await db.update('messages', existing.id, row); await db.q('DELETE FROM message_destinataires WHERE message_id=$1 AND school_id=$2', [m.id, db.sid]); }
  else m = await db.insert('messages', { ...row, expediteur_id: req.user.id, type: 'message' });
  for (const id of ids) await db.q('INSERT INTO message_destinataires (school_id,message_id,destinataire_id) VALUES ($1,$2,$3)', [db.sid, m.id, id]);
  for (const p of pieces) await db.q('UPDATE fichiers SET ref_id=$3 WHERE id=$1 AND school_id=$2', [p.id, db.sid, m.id]);
  if (!brouillon) await notify(db, ids, `Nouveau message : ${m.objet}`, `${req.user.prenom} ${req.user.nom}`, '#/messages');
  await audit(db, req.user, brouillon ? 'BROUILLON' : 'ENVOI', 'messages', m.id, null, { objet: m.objet, destinataires: ids.length });
  return m;
}
router.post('/messages', auth, allow('admin', 'comptable', 'enseignant', 'parent', 'eleve'), h(async (req, res, db) => { res.status(201); return persist(req, db, null); }));
async function draft(req, db) {
  const m = await db.find('messages', Number(req.params.id) || 0);
  if (!m || m.expediteur_id !== req.user.id || m.type !== 'message') throw new HttpError(404, 'Introuvable');
  if (m.statut !== 'brouillon') throw new HttpError(403, 'Message déjà envoyé : il ne peut être ni modifié ni supprimé (traçabilité)');
  return m;
}
router.put('/messages/:id', auth, allow('admin', 'comptable', 'enseignant', 'parent', 'eleve'), h(async (req, res, db) => persist(req, db, await draft(req, db))));
router.post('/messages/:id/envoyer', auth, allow('admin', 'comptable', 'enseignant', 'parent', 'eleve'), h(async (req, res, db) => {
  const m = await draft(req, db);
  const dest = (await db.q('SELECT destinataire_id FROM message_destinataires WHERE message_id=$1 AND school_id=$2', [m.id, db.sid])).map(x => x.destinataire_id);
  if (!dest.length) throw new HttpError(400, 'Choisissez au moins un destinataire (modifiez le brouillon)');
  const ok = new Set((await allowed(db, req.user)).map(a => a.id));
  if (dest.some(x => !ok.has(x))) throw new HttpError(403, 'Destinataire non autorisé');
  await db.update('messages', m.id, { statut: 'envoye', sent_at: new Date() });
  await notify(db, dest, `Nouveau message : ${m.objet}`, `${req.user.prenom} ${req.user.nom}`, '#/messages');
  await audit(db, req.user, 'ENVOI', 'messages', m.id, null, { destinataires: dest.length });
  return { ok: true };
}));
router.delete('/messages/:id', auth, allow('admin', 'comptable', 'enseignant', 'parent', 'eleve'), h(async (req, res, db) => {
  const m = await draft(req, db);
  await db.remove('messages', m.id);   // brouillon uniquement (cascade sur les destinataires)
  return { ok: true };
}));
router.post('/messages/:id/masquer', auth, allow('admin', 'comptable', 'enseignant', 'parent', 'eleve'), h(async (req, res, db) => {
  const r = await db.q('UPDATE message_destinataires SET masque=true WHERE message_id=$1 AND destinataire_id=$2 AND school_id=$3 RETURNING id', [Number(req.params.id) || 0, req.user.id, db.sid]);
  if (!r.length) throw new HttpError(404, 'Introuvable');
  return { ok: true };     // suppression logique côté destinataire uniquement
}));

// Annonces générales : immuables (ni modification ni suppression ; publier une annonce corrective)
router.post('/annonces', auth, allow('admin'), h(async (req, res, db) => {
  const d = await check(req.body || {}, { ...SCHEMA, cible: { type: 'enum', values: ['tous', 'parents', 'enseignants', 'eleves'], req: true, label: 'Destinataires' } }, db);
  const m = await db.insert('messages', { expediteur_id: req.user.id, type: 'annonce', objet: d.objet, corps: d.corps, cible: d.cible, statut: 'envoye', sent_at: new Date() });
  const roles = { tous: ['parent', 'enseignant', 'eleve', 'comptable'], parents: ['parent'], enseignants: ['enseignant'], eleves: ['eleve'] }[d.cible];
  const users = await db.q('SELECT id FROM users WHERE school_id=$1 AND actif AND role = ANY($2) AND id<>$3', [db.sid, roles, req.user.id]);
  await notify(db, users.map(x => x.id), `Annonce : ${d.objet}`, d.corps.slice(0, 200), '#/messages');
  await audit(db, req.user, 'ENVOI', 'annonces', m.id, null, { objet: d.objet, cible: d.cible });
  res.status(201); return m;
}));

module.exports = router;
