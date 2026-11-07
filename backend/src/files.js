// Fichiers : rangés par école (/data/uploads/<school_id>/<uuid>.<ext>), jamais servis sans contrôle d'accès.
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { HttpError } = require('./db');
const { auth, h } = require('./auth');
const { classScope, canSeeEleve, numbered } = require('./access');

const DIR = process.env.UPLOAD_DIR || '/data/uploads';
const EXT = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', txt: 'text/plain', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const upload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    if (!EXT[ext]) return cb(new HttpError(400, 'Type de fichier refusé (PDF, images, Word, Excel, texte uniquement)'));
    file.mimetype = EXT[ext]; cb(null, true);               // le type vient de l'extension, pas du client
  },
});

async function saveFile(db, user, file, contexte, refId) {
  const ext = path.extname(file.originalname).slice(1).toLowerCase(), id = crypto.randomUUID();
  const dir = path.join(DIR, String(db.sid));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.${ext}`), file.buffer);
  const nom = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[\\/]/g, '_').slice(0, 200);
  return db.insert('fichiers', { id, nom, chemin: `${db.sid}/${id}.${ext}`, mime: file.mimetype, taille: file.size, contexte, ref_id: refId || null, uploaded_by: user.id });
}

async function devoirVisible(req, db, id) {
  const p = [id, db.sid]; let sql = 'SELECT x.* FROM devoirs x WHERE x.id=$1 AND x.school_id=$2 AND x.deleted_at IS NULL';
  const s = classScope(req, db); if (s) { const [f, ps] = numbered(s, 2); sql += ' AND ' + f; p.push(...ps); }
  return db.one(sql, p);
}

async function canAccess(req, db, f) {
  const u = req.user;
  if (u.role === 'admin' || f.uploaded_by === u.id) return true;
  switch (f.contexte) {
    case 'photo': return u.role !== 'comptable' && canSeeEleve(req, db, f.ref_id);
    case 'devoir': return !!(f.ref_id && await devoirVisible(req, db, f.ref_id));
    case 'correction': {
      const d = f.ref_id && await devoirVisible(req, db, f.ref_id);
      if (!d) return false;
      return u.role === 'enseignant' || d.date_remise < new Date().toISOString().slice(0, 10);   // visible après la date de remise
    }
    case 'depot': { const d = await db.one('SELECT eleve_id FROM depots WHERE id=$1 AND school_id=$2', [f.ref_id, db.sid]); return !!d && canSeeEleve(req, db, d.eleve_id); }
    case 'message': return !!(await db.one(`SELECT 1 FROM messages m WHERE m.id=$1 AND m.school_id=$2 AND m.statut='envoye' AND (m.expediteur_id=$3 OR EXISTS
      (SELECT 1 FROM message_destinataires d WHERE d.message_id=m.id AND d.destinataire_id=$3))`, [f.ref_id, db.sid, u.id]));
    default: return false;
  }
}

const router = express.Router();
router.get('/fichiers/:id', auth, h(async (req, res, db) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new HttpError(404, 'Introuvable');
  const f = await db.find('fichiers', req.params.id);       // filtre école + RLS
  if (!f || !(await canAccess(req, db, f))) throw new HttpError(404, 'Introuvable');
  const full = path.join(DIR, f.chemin);
  if (!full.startsWith(DIR) || !fs.existsSync(full)) throw new HttpError(404, 'Fichier introuvable');
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `${f.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.nom)}`);
  fs.createReadStream(full).pipe(res);
}));
// Pièces jointes de messages : téléversées d'abord, rattachées ensuite à l'envoi
router.post('/fichiers', auth, upload.single('fichier'), h(async (req, res, db) => {
  if (!req.file) throw new HttpError(400, 'Fichier manquant');
  const f = await saveFile(db, req.user, req.file, 'message', null);
  res.status(201); return { id: f.id, nom: f.nom };
}));

module.exports = { upload, saveFile, router, devoirVisible, canAccess };
