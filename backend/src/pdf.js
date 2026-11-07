const PDFDocument = require('pdfkit');
const { niveauLabel } = require('./access');
const fmt = n => Number(n).toFixed(2).replace('.', ',');
const MODES = { especes: 'Espèces', virement: 'Virement', mobile_money: 'Mobile money' };
const fdate = d => String(d).slice(0, 10).split('-').reverse().join('/');

function start(res, filename, title, school) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: title } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  doc.rect(0, 0, 595, 80).fill('#1f3a5f');
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(18).text(school.name, 50, 28);
  doc.font('Helvetica').fontSize(10).text([school.adresse, school.telephone].filter(Boolean).join('  ·  ') || ' ', 50, 52);
  doc.fillColor('#000').moveDown(3).y = 110;
  doc.font('Helvetica-Bold').fontSize(16).text(title, 50, 110, { align: 'center' });
  doc.moveDown();
  return doc;
}

function recu(res, school, p, e, classe, parent, paye, du) {
  const doc = start(res, `recu-${p.numero_recu}.pdf`, `REÇU DE PAIEMENT N° ${p.numero_recu}`, school);
  doc.font('Helvetica').fontSize(11).moveDown(1.5);
  const line = (k, v) => { doc.font('Helvetica-Bold').text(k + ' : ', { continued: true }).font('Helvetica').text(String(v ?? '—')); doc.moveDown(0.3); };
  line('Date', fdate(p.date_paiement)); line('Élève', `${e.prenom} ${e.nom} (matricule ${e.matricule})`);
  line('Classe', classe ? `${niveauLabel(classe.niveau)} ${classe.section}` : '—'); line('Parent / tuteur', parent ? `${parent.prenom} ${parent.nom}` : '—');
  line('Année scolaire', p.annee_scolaire); line('Objet', p.libelle); line('Mode de paiement', MODES[p.mode] + (p.reference ? ` (réf. ${p.reference})` : ''));
  doc.moveDown().rect(50, doc.y, 495, 40).fill('#eef3f9').fillColor('#1f3a5f').font('Helvetica-Bold').fontSize(16)
    .text(`Montant reçu : ${fmt(p.montant)} TND`, 60, doc.y + 12);
  doc.fillColor('#000').font('Helvetica').fontSize(11).moveDown(3);
  line('Total dû pour l\'année', fmt(du) + ' TND'); line('Total payé à ce jour', fmt(paye) + ' TND'); line('Reste à payer', fmt(Math.max(0, du - paye)) + ' TND');
  doc.moveDown(2).fontSize(9).fillColor('#666').text('Document généré automatiquement — Cachet et signature de l\'école', { align: 'right' });
  doc.end();
}

function bulletin(res, school, b) {
  const e = b.eleve, doc = start(res, `bulletin-${e.matricule}-T${b.trimestre}.pdf`, `BULLETIN — Trimestre ${b.trimestre} — ${b.annee}`, school);
  doc.font('Helvetica').fontSize(11).fillColor('#000').moveDown(1);
  doc.text(`Élève : ${e.prenom} ${e.nom}   ·   Matricule : ${e.matricule}`);
  doc.text(`Classe : ${b.classe || '—'}   ·   Né(e) le : ${fdate(e.date_naissance)}`).moveDown();
  let y = doc.y; const cols = [50, 270, 340, 420, 490];
  doc.rect(50, y, 495, 20).fill('#1f3a5f').fillColor('#fff').font('Helvetica-Bold').fontSize(10);
  ['Matière', 'Coef.', 'Moyenne /20', 'Moy. classe', ''].forEach((t, i) => doc.text(t, cols[i] + 5, y + 5, { width: 80 }));
  y += 20; doc.fillColor('#000').font('Helvetica');
  b.matieres.forEach((m, i) => {
    if (i % 2 === 0) doc.rect(50, y, 495, 20).fill('#f3f6fa').fillColor('#000');
    doc.text(m.matiere, cols[0] + 5, y + 5, { width: 210 }).text(String(m.coefficient).replace('.', ','), cols[1] + 5, y + 5)
      .text(fmt(m.moyenne), cols[2] + 5, y + 5).text(fmt(m.moyenne_classe), cols[3] + 5, y + 5);
    y += 20;
  });
  doc.y = y + 15; doc.x = 50;
  doc.font('Helvetica-Bold').fontSize(13).text(`Moyenne générale : ${b.moyenne_generale == null ? '—' : fmt(b.moyenne_generale) + ' / 20'}`);
  doc.font('Helvetica').fontSize(11).text(`Rang : ${b.rang ? `${b.rang} / ${b.effectif}` : '—'}`);
  doc.text(`Absences (année) : ${b.absences.total} dont ${b.absences.non_justifiees} non justifiée(s)`).moveDown();
  doc.font('Helvetica-Oblique').text(`Appréciation : ${b.appreciation}`);
  doc.moveDown(3).fontSize(9).fillColor('#666').text('Le directeur', { align: 'right' });
  doc.end();
}
module.exports = { recu, bulletin };
