// Données de démonstration : 2 écoles fictives (pour tester l'isolation) + 1 super-administrateur.
const bcrypt = require('bcryptjs');
const { tx } = require('./db');

const PWD = process.env.DEMO_PASSWORD || 'Demo@2026';
const ANNEE = '2026-2027';
const data = [
  { name: 'École Primaire Abou el Kacem Chebbi', slug: 'aboukacem', adresse: '12 rue de la République, Sousse', tel: '+216 73 200 100',
    teachers: [['Ben Salah', 'Mounir', 'M'], ['Trabelsi', 'Salma', 'F'], ['Gharbi', 'Hichem', 'M']],
    parents: [['Hammami', 'Karim'], ['Jlassi', 'Nadia'], ['Mejri', 'Sami'], ['Bouazizi', 'Leila'], ['Khelifi', 'Anis'], ['Dridi', 'Rim']],
    eleves: [['Hammami', 'Youssef', 'M', '2020-03-14', 0], ['Hammami', 'Aya', 'F', '2019-07-02', 0], ['Jlassi', 'Mariem', 'F', '2020-11-21', 1], ['Mejri', 'Adam', 'M', '2020-05-30', 2],
      ['Bouazizi', 'Rayan', 'M', '2018-09-09', 3], ['Khelifi', 'Sarra', 'F', '2019-01-17', 4], ['Dridi', 'Omar', 'M', '2018-12-05', 5], ['Jlassi', 'Ines', 'F', '2018-04-25', 1],
      ['Mejri', 'Nour', 'F', '2017-02-11', 2], ['Bouazizi', 'Amine', 'M', '2017-08-19', 3], ['Khelifi', 'Yassine', 'M', '2018-06-03', 4], ['Dridi', 'Lina', 'F', '2019-10-12', 5]] },
  { name: 'École Primaire Ibn Khaldoun', slug: 'ibnkhaldoun', adresse: '5 avenue Habib Bourguiba, Monastir', tel: '+216 73 460 200',
    teachers: [['Chaabane', 'Walid', 'M'], ['Mansouri', 'Hela', 'F'], ['Zouari', 'Fares', 'M']],
    parents: [['Ayari', 'Tarek'], ['Baccouche', 'Samia'], ['Cherif', 'Nizar'], ['Hajji', 'Olfa'], ['Saidi', 'Walid'], ['Tlili', 'Ghada']],
    eleves: [['Ayari', 'Mehdi', 'M', '2020-02-08', 0], ['Baccouche', 'Eya', 'F', '2020-09-27', 1], ['Cherif', 'Ziad', 'M', '2020-06-15', 2], ['Hajji', 'Maram', 'F', '2019-03-22', 3],
      ['Saidi', 'Aymen', 'M', '2019-12-01', 4], ['Tlili', 'Cyrine', 'F', '2018-05-18', 5], ['Ayari', 'Khalil', 'M', '2018-01-30', 0], ['Baccouche', 'Malek', 'M', '2017-10-07', 1],
      ['Cherif', 'Yasmine', 'F', '2017-04-14', 2], ['Hajji', 'Bilel', 'M', '2018-08-23', 3], ['Saidi', 'Emna', 'F', '2019-07-09', 4], ['Tlili', 'Firas', 'M', '2018-11-16', 5]] },
];
const MATIERES = [['Arabe', 3, null], ['Français', 3, null], ['Mathématiques', 3, null], ['Éveil scientifique', 1.5, null], ['Éducation islamique', 1, null], ['Éducation physique', 1, null], ['Anglais', 1.5, 3]];
const notePour = (i, j) => Math.round((8 + ((i * 7 + j * 5) % 11) + (j % 3) * 0.5) * 4) / 4;   // notes pseudo-aléatoires reproductibles

async function seedIfEmpty() {
  const n = await tx({ bypass: true }, db => db.one('SELECT count(*)::int n FROM users'));
  if (n.n > 0) return;
  console.log('Base vide : insertion des données de démonstration…');
  const hash = await bcrypt.hash(PWD, 10), superHash = await bcrypt.hash(process.env.SUPERADMIN_PASSWORD || 'Super@2026', 10);
  await tx({ bypass: true }, db => db.q(`INSERT INTO users (email,password_hash,role,nom,prenom) VALUES ($1,$2,'superadmin','Super','Admin') ON CONFLICT DO NOTHING`, [process.env.SUPERADMIN_EMAIL || 'super@ecole-saas.tn', superHash]));
  if (process.env.SEED_DEMO === 'false') { console.log('SEED_DEMO=false : seul le super-administrateur est créé.'); return; }
  for (const S of data) {
    const school = await tx({ bypass: true }, db0 => db0.one(`INSERT INTO schools (name,status,plan,subscription_end,annee_courante,adresse,telephone,email) VALUES ($1,'active','standard',CURRENT_DATE + 365,$2,$3,$4,$5) RETURNING id`,
      [S.name, ANNEE, S.adresse, S.tel, `contact@${S.slug}.tn`]));
    const sid = school.id;
    await tx({ bypass: true, schoolId: sid }, async db => {
      const mkUser = async (email, role, nom, prenom, tel) => (await db.insert('users', { email, password_hash: hash, role, nom, prenom, telephone: tel || null })).id;
      await mkUser(`admin@${S.slug}.tn`, 'admin', 'Directeur', S.slug === 'aboukacem' ? 'Habib' : 'Moncef', '+216 98 000 001');
      await mkUser(`comptable@${S.slug}.tn`, 'comptable', 'Comptable', 'Rachida', '+216 98 000 002');
      const T = [];
      for (let i = 0; i < S.teachers.length; i++) T.push(await mkUser(`${S.teachers[i][0].toLowerCase().replace(/\s+/g, '')}@${S.slug}.tn`, 'enseignant', S.teachers[i][0], S.teachers[i][1], `+216 97 100 0${i}0`));
      const P = [];
      for (let i = 0; i < S.parents.length; i++) P.push(await mkUser(`${S.parents[i][0].toLowerCase().replace(/\s+/g, '')}@${S.slug}.tn`, 'parent', S.parents[i][0], S.parents[i][1], `+216 55 200 0${i}0`));
      const mat = [];
      for (const [nom, coef, niv] of MATIERES) mat.push((await db.insert('matieres', { nom, coefficient: coef, niveau: niv })).id);
      for (const [nom, cap] of [['Salle 1', 25], ['Salle 2', 25], ['Salle 3', 30], ['Salle de sport', 40]]) await db.insert('salles', { nom, capacite: cap });
      const salles = await db.q('SELECT id FROM salles WHERE school_id=$1 ORDER BY id', [sid]);
      const classes = [];
      for (let k = 0; k < 3; k++) classes.push(await db.insert('classes', { niveau: k + 1, section: 'A', capacite: 25, annee_scolaire: ANNEE, enseignant_id: T[k] }));
      classes.push(await db.insert('classes', { niveau: 4, section: 'A', capacite: 25, annee_scolaire: ANNEE, enseignant_id: null }));
      // Affectations : le titulaire enseigne toutes les matières de sa classe (sauf EPS/Anglais confiés au 3ème enseignant)
      for (let k = 0; k < 4; k++) for (let m = 0; m < MATIERES.length; m++) {
        const niv = MATIERES[m][2]; if (niv && niv !== k + 1) continue;
        const ens = k === 3 ? T[2] : (m >= 5 ? T[2] : T[k]);
        await db.insert('affectations', { enseignant_id: ens, matiere_id: mat[m], classe_id: classes[k].id });
      }
      await db.q('UPDATE classes SET enseignant_id=$2 WHERE id=$1', [classes[3].id, T[2]]);
      // Élèves
      const el = [];
      for (let i = 0; i < S.eleves.length; i++) {
        const [nom, prenom, sexe, dn, pi] = S.eleves[i], an = +dn.slice(0, 4), niv = Math.min(4, Math.max(1, 2026 - an - 5));
        el.push(await db.insert('eleves', { matricule: `EL2026-${String(i + 1).padStart(4, '0')}`, nom, prenom, sexe, date_naissance: dn, adresse: S.adresse.split(',')[1].trim(),
          annee_entree: an + 6, classe_id: classes[niv - 1].id, parent_id: P[pi], statut: 'inscrit', derniere_relance: new Date().toISOString().slice(0, 10), antecedents_medicaux: i % 5 === 0 ? 'Allergie aux arachides' : null }));
      }
      // Demandes de pré-inscription en attente (une d'un parent déjà inscrit, une d'une nouvelle famille)
      await db.insert('preinscriptions', { parent_nom: S.parents[0][0], parent_prenom: S.parents[0][1], parent_email: `${S.parents[0][0].toLowerCase()}@${S.slug}.tn`, parent_telephone: '+216 55 200 000', enfant_nom: S.parents[0][0], enfant_prenom: 'Sirine', date_naissance: '2020-10-10', sexe: 'F', adresse: S.adresse.split(',')[1].trim() });
      await db.insert('preinscriptions', { parent_nom: 'Nouveau', parent_prenom: 'Parent', parent_email: `nouveau.parent@${S.slug}.tn`, parent_telephone: '+216 22 333 444', enfant_nom: 'Nouveau', enfant_prenom: 'Karim', date_naissance: '2019-04-12', sexe: 'M', adresse: 'Sousse' });
      const eu = await mkUser(`${S.eleves[0][1].toLowerCase()}.${S.eleves[0][0].toLowerCase()}@${S.slug}.tn`, 'eleve', S.eleves[0][0], S.eleves[0][1]);
      await db.q('UPDATE eleves SET user_id=$2 WHERE id=$1', [el[0].id, eu]);
      // Tarifs & paiements
      for (const [lib, mt] of [['Inscription', 80], ['Scolarité — 1er trimestre', 250], ['Scolarité — 2ème trimestre', 250], ['Scolarité — 3ème trimestre', 250]]) await db.insert('tarifs', { annee_scolaire: ANNEE, libelle: lib, montant: mt });
      let rc = 1;
      for (let i = 0; i < el.length; i++) {
        const plan = i % 4 === 3 ? [] : i % 4 === 2 ? [[80, 'especes']] : i % 4 === 1 ? [[80, 'especes'], [250, 'virement']] : [[80, 'especes'], [250, 'especes'], [250, 'mobile_money'], [250, 'virement']];
        for (const [mt, mode] of plan) await db.insert('paiements', { eleve_id: el[i].id, annee_scolaire: ANNEE, montant: mt, date_paiement: `2026-09-${String(3 + (rc % 20)).padStart(2, '0')}`, mode,
          libelle: mt === 80 ? 'Inscription' : 'Scolarité', reference: mode === 'especes' ? null : `REF${1000 + rc}`, numero_recu: `R2026-${String(rc++).padStart(5, '0')}` });
      }
      // Emploi du temps
      const slots = [['08:00', '09:00'], ['09:00', '10:00'], ['10:30', '11:30'], ['11:30', '12:30']];
      for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) {
        const m = [0, 1, 2, 3][(j + k) % 4], aff = await db.one('SELECT enseignant_id FROM affectations WHERE classe_id=$1 AND matiere_id=$2 AND school_id=$3', [classes[k].id, mat[m], sid]);
        await db.insert('creneaux', { classe_id: classes[k].id, matiere_id: mat[m], enseignant_id: aff.enseignant_id, salle_id: salles[k].id, jour: 1 + (j % 3) + (k === 3 ? 3 : 0), debut: slots[j][0], fin: slots[j][1] });
      }
      // Évaluations & notes (1er trimestre)
      for (let k = 0; k < 4; k++) for (let m = 0; m < 4; m++) {
        const e = await db.insert('evaluations', { classe_id: classes[k].id, matiere_id: mat[m], titre: `Contrôle ${MATIERES[m][0]} n°1`, type: 'controle', trimestre: 1, date_eval: `2026-10-${String(5 + m * 3 + k).padStart(2, '0')}`, bareme: 20, annee_scolaire: ANNEE });
        const members = el.filter(x => x.classe_id === classes[k].id);
        for (let i = 0; i < members.length; i++) await db.insert('notes', { evaluation_id: e.id, eleve_id: members[i].id, valeur: Math.min(20, notePour(i + k, m)) });
      }
      // Absences
      await db.insert('absences', { eleve_id: el[1].id, date_absence: '2026-10-12', periode: 'journee', motif: 'Maladie', justifiee: true, justification: 'Certificat médical fourni', annee_scolaire: ANNEE });
      await db.insert('absences', { eleve_id: el[3].id, date_absence: '2026-10-20', periode: 'matin', motif: 'Non précisé', justifiee: false, annee_scolaire: ANNEE });
      // Devoirs & dépôts
      const dv = [];
      for (let k = 0; k < 3; k++) dv.push(await db.insert('devoirs', { classe_id: classes[k].id, matiere_id: mat[2], enseignant_id: T[k], titre: `Exercices de mathématiques — série ${k + 1}`, description: 'Résoudre les exercices 1 à 5 de la page 42 et soigner la présentation.', date_remise: '2026-11-15', bareme: 20 }));
      const m0 = el.find(x => x.classe_id === classes[0].id);
      const m1 = el.filter(x => x.classe_id === classes[0].id)[1] || m0;
      await db.insert('depots', { devoir_id: dv[0].id, eleve_id: m1.id, fichiers: '[]', note: 17, commentaire: 'Très bon travail, bien présenté.' });
      // Messages & annonce
      const adm = (await db.one(`SELECT id FROM users WHERE school_id=$1 AND role='admin'`, [sid])).id;
      const ann = await db.insert('messages', { expediteur_id: adm, type: 'annonce', objet: 'Réunion parents-professeurs', corps: 'Une réunion avec les parents aura lieu le samedi 14 novembre 2026 à 10h dans la salle polyvalente.', cible: 'tous', statut: 'envoye', sent_at: new Date() });
      const msg = await db.insert('messages', { expediteur_id: T[0], type: 'message', objet: 'Progrès de votre enfant', corps: 'Bonjour, je souhaite vous informer que votre enfant progresse très bien ce trimestre. Cordialement.', eleve_id: m0.id, statut: 'envoye', sent_at: new Date() });
      await db.q('INSERT INTO message_destinataires (school_id,message_id,destinataire_id) VALUES ($1,$2,$3)', [sid, msg.id, m0.parent_id]);
      await db.q('INSERT INTO notifications (school_id,user_id,titre,texte,lien) VALUES ($1,$2,$3,$4,$5)', [sid, m0.parent_id, 'Nouveau message : Progrès de votre enfant', 'Message de votre enseignant', '#/messages']);
    });
  }
  console.log('Données de démonstration insérées.');
}
module.exports = { seedIfEmpty };
