const express = require('express');
const { HttpError, audit } = require('../db');
const { auth, allow, h } = require('../auth');
const { startYear } = require('../validate');
const { eleveScope, mustSeeEleve, numbered } = require('../access');
const { sendSystemMessage } = require('../notify');
const crud = require('../crud');
const pdf = require('../pdf');
const router = express.Router();
const STAFF = ['admin', 'comptable'];
const money = n => Number(n).toFixed(2).replace('.', ',');
const fdate = d => String(d).slice(0, 10).split('-').reverse().join('/');
const MODES = { especes: 'espèces', virement: 'virement', mobile_money: 'mobile money' };

async function solde(db, eleveId, annee, excludePayment = 0) {
  const du = (await db.one('SELECT COALESCE(sum(montant),0) v FROM tarifs WHERE school_id=$1 AND annee_scolaire=$2', [db.sid, annee])).v;
  const paye = (await db.one('SELECT COALESCE(sum(montant),0) v FROM paiements WHERE school_id=$1 AND eleve_id=$2 AND annee_scolaire=$3 AND deleted_at IS NULL AND id<>$4', [db.sid, eleveId, annee, excludePayment])).v;
  return { du, paye, reste: Math.round((du - paye) * 100) / 100 };
}

// Suivi des impayés
router.get('/paiements/soldes', auth, allow('admin', 'comptable', 'parent'), h(async (req, res, db) => {
  const annee = req.user.school.annee_courante, p = [db.sid, annee];
  let sql = `SELECT e.id,e.nom,e.prenom,e.matricule,e.parent_id,(SELECT niveau||section FROM classes c WHERE c.id=e.classe_id) AS classe,
    COALESCE((SELECT sum(montant) FROM tarifs t WHERE t.school_id=e.school_id AND t.annee_scolaire=$2),0) AS du,
    COALESCE((SELECT sum(montant) FROM paiements p WHERE p.eleve_id=e.id AND p.school_id=e.school_id AND p.annee_scolaire=$2 AND p.deleted_at IS NULL),0) AS paye
    FROM eleves e WHERE e.school_id=$1 AND e.deleted_at IS NULL AND e.statut='inscrit'`;
  const s = eleveScope(req, db, 'e.id'); if (s) { const [f, ps] = numbered(s, 2); sql += ' AND ' + f; p.push(...ps); }
  const rows = await db.q(sql + ' ORDER BY e.nom,e.prenom', p);
  const full = rows.map(r => ({ ...r, reste: Math.round((r.du - r.paye) * 100) / 100 }));
  if (req.user.role !== 'admin') return full;
  // La direction voit QUI a payé ou non, jamais les montants ni les détails.
  return full.map(r => ({ id: r.id, nom: r.nom, prenom: r.prenom, matricule: r.matricule, classe: r.classe,
    statut: r.du <= 0 || r.reste <= 0 ? 'solde' : r.paye > 0 ? 'partiel' : 'impaye' }));
}));

// Relances (manuelles ou automatiques) : message au parent de chaque élève ayant un solde > 0
async function relancer(db, fromId, annee, seulementAnciennes) {
  const rows = await db.q(`SELECT e.id,e.prenom,e.nom,e.parent_id,
    COALESCE((SELECT sum(montant) FROM tarifs t WHERE t.school_id=e.school_id AND t.annee_scolaire=$2),0) -
    COALESCE((SELECT sum(montant) FROM paiements p WHERE p.eleve_id=e.id AND p.school_id=e.school_id AND p.annee_scolaire=$2 AND p.deleted_at IS NULL),0) AS reste
    FROM eleves e WHERE e.school_id=$1 AND e.deleted_at IS NULL AND e.statut='inscrit' AND e.parent_id IS NOT NULL
    ${seulementAnciennes ? "AND (e.derniere_relance IS NULL OR e.derniere_relance < CURRENT_DATE - 30)" : ''}`, [db.sid, annee]);
  let n = 0;
  for (const r of rows) {
    const reste = Math.round(r.reste * 100) / 100; if (reste <= 0) continue;
    await sendSystemMessage(db, fromId, [r.parent_id], 'Rappel de paiement', `Bonjour, il reste ${money(reste)} TND à régler pour la scolarité de ${r.prenom} ${r.nom} (année ${annee}). Merci de régulariser auprès du secrétariat. Si vous avez déjà payé, veuillez ignorer ce message.`, { eleveId: r.id });
    await db.q('UPDATE eleves SET derniere_relance=CURRENT_DATE WHERE id=$1 AND school_id=$2', [r.id, db.sid]);
    n++;
  }
  return n;
}
router.post('/paiements/relances', auth, allow('comptable'), h(async (req, res, db) => {
  const n = await relancer(db, req.user.id, req.user.school.annee_courante, false);
  await audit(db, req.user, 'RELANCE', 'paiements', null, null, { envoyees: n });
  return { envoyees: n };
}));

// Direction : liste des reçus (sans le détail financier), téléchargeables un par un
router.get('/recus', auth, allow('admin'), h((req, res, db) => db.q(`SELECT p.id,p.numero_recu,p.date_paiement,p.libelle,p.annee_scolaire,
  (SELECT nom||' '||prenom FROM eleves e WHERE e.id=p.eleve_id) AS eleve FROM paiements p WHERE p.school_id=$1 AND p.deleted_at IS NULL ORDER BY p.date_paiement DESC,p.id DESC LIMIT 1000`, [db.sid])));
router.get('/paiements/:id/recu', auth, allow('admin', 'comptable', 'parent'), h(async (req, res, db) => {
  const p = await db.find('paiements', Number(req.params.id) || 0);
  if (!p) throw new HttpError(404, 'Introuvable');
  const e = await mustSeeEleve(req, db, p.eleve_id);
  const classe = e.classe_id && await db.find('classes', e.classe_id);
  const parent = e.parent_id && await db.one('SELECT nom,prenom FROM users WHERE id=$1 AND school_id=$2', [e.parent_id, db.sid]);
  const s = await solde(db, e.id, p.annee_scolaire);
  pdf.recu(res, await db.one('SELECT name,adresse,telephone FROM schools WHERE id=$1', [db.sid]), p, e, classe, parent, s.paye, s.du);
}));

crud(router, 'paiements', {
  table: 'paiements', read: ['comptable', 'parent'], write: ['comptable'], filters: ['eleve_id', 'annee_scolaire'], order: 'x.date_paiement DESC, x.id DESC',
  scope: (req, db) => eleveScope(req, db),
  cols: `x.*,(SELECT nom||' '||prenom FROM eleves e WHERE e.id=x.eleve_id) AS eleve,(SELECT nom||' '||prenom FROM users u WHERE u.id=x.saisi_par) AS saisi_par_nom`,
  schema: {
    eleve_id: { type: 'ref', table: 'eleves', req: true, label: 'Élève' }, montant: { type: 'num', min: 0.01, max: 100000, req: true, label: 'Montant' },
    date_paiement: { type: 'date', req: true, noFuture: true, label: 'Date' }, mode: { type: 'enum', values: ['especes', 'virement', 'mobile_money'], req: true, label: 'Mode' },
    libelle: { type: 'str', min: 3, max: 100, def: 'Scolarité', label: 'Objet' }, reference: { type: 'str', max: 60, label: 'Référence' },
  },
  async before(db, d, req, old) {
    d.montant = Math.round(d.montant * 100) / 100;
    const e = await db.find('eleves', d.eleve_id);
    if (e.statut !== 'inscrit') throw new HttpError(400, 'L\'élève n\'est pas encore inscrit (pré-inscription non validée)');
    const annee = old?.annee_scolaire || req.user.school.annee_courante;
    if (d.date_paiement < `${startYear(annee)}-06-01`) throw new HttpError(400, `Date : antérieure à l'année scolaire ${annee}`);
    if (d.mode !== 'especes' && !d.reference) throw new HttpError(400, 'Référence : obligatoire pour un virement ou un paiement mobile');
    const s = await solde(db, d.eleve_id, annee, old?.id || 0);
    if (s.du <= 0) throw new HttpError(400, `Aucune grille tarifaire définie pour ${annee} (menu Tarifs)`);
    if (d.montant > s.reste + 0.001) throw new HttpError(400, `Montant : dépasse le solde restant (${money(s.reste)} TND)`);
    d.annee_scolaire = annee;
    if (!old) {
      d.saisi_par = req.user.id;
      let n = (await db.one('SELECT count(*)::int n FROM paiements WHERE school_id=$1', [db.sid])).n + 1, num;
      do { num = `R${startYear(annee)}-${String(n++).padStart(5, '0')}`; } while (await db.one('SELECT 1 FROM paiements WHERE school_id=$1 AND numero_recu=$2', [db.sid, num]));
      d.numero_recu = num;
    }
  },
  // Notification automatique du parent après chaque paiement enregistré
  async after(db, row, req, isNew) {
    if (!isNew) return;
    const e = await db.find('eleves', row.eleve_id), s = await solde(db, e.id, row.annee_scolaire);
    if (!e.parent_id) { await db.q('INSERT INTO envois_log (school_id,destinataire_id,canal,sujet,statut) VALUES ($1,NULL,$2,$3,$4)', [db.sid, 'messagerie', 'Paiement ' + row.numero_recu, 'echec_sans_parent']); return; }
    await sendSystemMessage(db, req.user.id, [e.parent_id], `Paiement enregistré — reçu ${row.numero_recu}`,
      `Bonjour, un paiement de ${money(row.montant)} TND a été enregistré pour ${e.prenom} ${e.nom} le ${fdate(row.date_paiement)} (${MODES[row.mode]}).\nNouveau solde restant : ${money(s.reste)} TND.\nReçu à télécharger : /api/paiements/${row.id}/recu`, { eleveId: e.id, lien: `/api/paiements/${row.id}/recu` });
  },
});

module.exports = router;
module.exports.relancer = relancer;
