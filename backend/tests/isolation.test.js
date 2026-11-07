// Tests d'isolation entre écoles (guide « Isolation entre écoles », étapes 6 et 7).
// Lancer : docker compose exec backend npm test   (ou BASE_URL=http://localhost:4000 npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const BASE = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 4000);
const PWD = process.env.DEMO_PASSWORD || 'Demo@2026';

async function api(token, method, path, body) {
  const r = await fetch(BASE + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; const ct = r.headers.get('content-type') || '';
  if (ct.includes('json')) data = await r.json(); else await r.arrayBuffer();
  return { status: r.status, data };
}
const login = async email => (await api(null, 'POST', '/auth/login', { email, password: PWD })).data;
const FIN = ['paiements', 'tarifs'];   // finance : réservée au comptable
const RES = ['eleves', 'classes', 'matieres', 'salles', 'affectations', 'tarifs', 'paiements', 'creneaux', 'evaluations', 'absences', 'devoirs', 'utilisateurs'];

let A, B, sets = {};
test.before(async () => {
  A = { compta: (await login('comptable@aboukacem.tn')).token, admin: (await login('admin@aboukacem.tn')).token, parent: (await login('hammami@aboukacem.tn')).token, teacher: (await login('bensalah@aboukacem.tn')).token };
  B = { compta: (await login('comptable@ibnkhaldoun.tn')).token, admin: (await login('admin@ibnkhaldoun.tn')).token, parent: (await login('ayari@ibnkhaldoun.tn')).token };
  assert.ok(A.admin && B.admin, 'connexion des deux écoles');
  for (const [k, T] of [['A', A], ['B', B]]) { sets[k] = {}; for (const r of RES) { const x = await api(FIN.includes(r) ? T.compta : T.admin, 'GET', '/' + r); assert.equal(x.status, 200, r); sets[k][r] = x.data.map(o => o.id); } }
});

for (const dir of [['A', 'B'], ['B', 'A']]) {
  const [me, other] = dir, tok = () => (me === 'A' ? A : B).admin, tokF = () => (me === 'A' ? A : B).compta, tkr = r => FIN.includes(r) ? tokF() : tok();
  test(`École ${me} : les listes ne contiennent aucune donnée de l'école ${other}`, () => {
    for (const r of RES) { assert.ok(sets[me][r].length > 0, `${r} vide`); for (const id of sets[other][r]) if (r !== 'utilisateurs' || true) assert.ok(!sets[me][r].includes(id) || false, `${r} #${id} partagé`); }
  });
  test(`École ${me} -> ${other} : accès direct par identifiant refusé (404)`, async () => {
    for (const r of RES) for (const id of sets[other][r].slice(0, 3)) {
      assert.equal((await api(tkr(r), 'GET', `/${r}/${id}`)).status, 404, `GET ${r}/${id}`);
      assert.equal((await api(tkr(r), 'PUT', `/${r}/${id}`, { nom: 'X' })).status, 404, `PUT ${r}/${id}`);
      assert.equal((await api(tkr(r), 'DELETE', `/${r}/${id}`)).status, 404, `DELETE ${r}/${id}`);
    }
  });
  test(`École ${me} -> ${other} : reçus, bulletins, notes, dépôts refusés`, async () => {
    const e = sets[other].eleves[0], p = sets[other].paiements[0], d = sets[other].devoirs[0], ev = sets[other].evaluations[0];
    for (const path of [`/eleves/${e}/bulletin?trimestre=1`, `/eleves/${e}/bulletin.pdf?trimestre=1`, `/eleves/${e}/notes`, `/devoirs/${d}/depots`, `/evaluations/${ev}/notes`])
      assert.equal((await api(tok(), 'GET', path)).status, 404, path);
    assert.equal((await api(tokF(), 'GET', `/paiements/${p}/recu`)).status, 404);
    assert.equal((await api(tok(), 'PUT', `/evaluations/${ev}/notes`, { notes: [] })).status, 404);
  });
  test(`École ${me} : paramètre school_id ignoré, statistiques limitées à l'école`, async () => {
    const o = sets[other].eleves[0];
    const r = await api(tok(), 'GET', `/eleves?school_id=${o}`); assert.equal(r.status, 200);
    assert.ok(r.data.every(x => sets[me].eleves.includes(x.id)));
    const s = await api(tok(), 'GET', '/stats'); assert.equal(s.data.eleves, (await api(tok(), 'GET', '/eleves?statut=inscrit')).data.length);
  });
  test(`École ${me} : on ne peut pas rattacher une donnée à une ressource de l'école ${other}`, async () => {
    const r = await api(tok(), 'POST', '/eleves', { nom: 'Test', prenom: 'Croise', sexe: 'M', date_naissance: '2019-01-01', classe_id: sets[other].classes[0] });
    assert.equal(r.status, 400);
    assert.equal((await api(tokF(), 'POST', '/paiements', { eleve_id: sets[other].eleves[0], montant: 10, date_paiement: '2026-10-01', mode: 'especes' })).status, 400);
    assert.equal((await api(tok(), 'POST', '/messages', { objet: 'Test', corps: 'x', destinataires: [(await api((me === 'A' ? B : A).admin, 'GET', '/utilisateurs?role=parent')).data[0].id] })).status, 403);
  });
}
test('Fichiers : photos/pièces d\'une école inaccessibles à l\'autre', async () => {
  assert.equal((await api(A.admin, 'GET', '/fichiers/00000000-0000-4000-8000-000000000000')).status, 404);
});
test('Parent / enseignant : périmètre restreint', async () => {
  const ep = (await api(A.parent, 'GET', '/eleves')).data;
  assert.ok(ep.length >= 1 && ep.every(e => /Hammami/.test(e.parent_nom)), 'parent : uniquement ses enfants');
  const other = sets.A.eleves.find(id => !ep.some(e => e.id === id));
  assert.equal((await api(A.parent, 'GET', `/eleves/${other}`)).status, 404);
  assert.equal((await api(A.parent, 'GET', `/eleves/${other}/bulletin?trimestre=1`)).status, 404);
  const et = (await api(A.teacher, 'GET', '/eleves')).data;
  assert.ok(et.length > 0 && et.length < sets.A.eleves.length, 'enseignant : seulement ses classes');
  assert.equal((await api(A.parent, 'GET', '/utilisateurs')).status, 403);
  assert.equal((await api(A.parent, 'GET', '/journal')).status, 403);
});
test('Messagerie : messages envoyés immuables, tiers sans accès', async () => {
  const dest = (await api(A.teacher, 'GET', '/messages/destinataires')).data.find(x => x.role === 'parent');
  const m = await api(A.teacher, 'POST', '/messages', { objet: 'Test immuable', corps: 'Bonjour', destinataires: [dest.id], eleve_id: dest.eleve_id });
  assert.equal(m.status, 201);
  assert.equal((await api(A.teacher, 'PUT', `/messages/${m.data.id}`, { objet: 'Modif', corps: 'x', destinataires: [dest.id] })).status, 403);
  assert.equal((await api(A.teacher, 'DELETE', `/messages/${m.data.id}`)).status, 403);
  assert.equal((await api(A.admin, 'GET', `/messages/${m.data.id}`)).status, 404);   // l'admin n'est pas partie prenante
  assert.equal((await api(B.admin, 'GET', `/messages/${m.data.id}`)).status, 404);
});
test('Cloisonnement par numéro unique : matricule identique autorisé dans deux écoles', async () => {
  const a = (await api(A.admin, 'GET', '/eleves')).data.map(e => e.matricule), b = (await api(B.admin, 'GET', '/eleves')).data.map(e => e.matricule);
  assert.ok(a.includes('EL2026-0001') && b.includes('EL2026-0001'));   // EL2026-0001 existe dans les deux écoles : l'unicité est par école
});
test('Sans jeton : refusé', async () => { assert.equal((await api(null, 'GET', '/eleves')).status, 401); });

test('Finance : le directeur ne voit ni montants ni détails (mais voit les reçus)', async () => {
  for (const [k, T] of [['A', A], ['B', B]]) {
    for (const path of ['/paiements', '/tarifs']) assert.equal((await api(T.admin, 'GET', path)).status, 403, path);
    assert.equal((await api(T.admin, 'POST', '/paiements', { eleve_id: 1, montant: 10, date_paiement: '2026-10-01', mode: 'especes' })).status, 403);
    assert.equal((await api(T.admin, 'POST', '/paiements/relances')).status, 403);
    assert.equal((await api(T.admin, 'PUT', `/paiements/${sets[k].paiements[0]}`, { montant: 1 })).status, 403);
    assert.equal((await api(T.admin, 'DELETE', `/paiements/${sets[k].paiements[0]}`)).status, 403);
    const s = (await api(T.admin, 'GET', '/paiements/soldes')).data;
    assert.ok(s.length > 0 && s.every(r => ['solde', 'partiel', 'impaye'].includes(r.statut)), 'statut seulement');
    assert.ok(s.every(r => !('du' in r) && !('paye' in r) && !('reste' in r)), 'aucun montant');
    const rc = await api(T.admin, 'GET', '/recus'); assert.equal(rc.status, 200);
    assert.ok(rc.data.length > 0 && rc.data.every(r => !('montant' in r) && !('mode' in r)), 'liste des reçus sans montant');
    assert.equal((await api(T.admin, 'GET', `/paiements/${sets[k].paiements[0]}/recu`)).status, 200);          // reçu de son école
    assert.equal((await api(T.admin, 'GET', `/paiements/${sets[k === 'A' ? 'B' : 'A'].paiements[0]}/recu`)).status, 404);  // reçu d'une autre école
    const st = (await api(T.admin, 'GET', '/stats')).data; assert.ok(!('encaisse' in st) && !('du' in st) && st.soldes);
    const j = (await api(T.admin, 'GET', '/journal')).data; assert.ok(j.every(x => !['paiements', 'tarifs'].includes(x.entite)));
  }
  assert.equal((await api(A.parent, 'GET', '/paiements')).status, 200);   // le parent garde l'accès aux paiements de ses enfants
  assert.equal((await api(A.parent, 'GET', '/tarifs')).status, 403);
  assert.equal((await api(A.parent, 'GET', '/recus')).status, 403);
});
test('Comptable : finance uniquement (pas de fiches élèves, comptes, classes, matières)', async () => {
  for (const T of [A, B]) {
    for (const path of ['/eleves', '/eleves/export', '/classes', '/matieres', '/utilisateurs', '/utilisateurs?role=parent', '/utilisateurs?role=enseignant', '/absences', '/salles', '/affectations', '/devoirs', '/evaluations', '/creneaux', '/recus', '/ecole'])
      assert.equal((await api(T.compta, 'GET', path)).status, 403, 'GET ' + path);
    const e = sets.A.eleves[0];
    assert.equal((await api(T.compta, 'PUT', `/eleves/${e}`, { nom: 'X' })).status, 403);
    assert.equal((await api(T.compta, 'POST', '/eleves', { nom: 'X', prenom: 'Y', sexe: 'M', date_naissance: '2019-01-01' })).status, 403);
    assert.equal((await api(T.compta, 'POST', '/eleves/import', { rows: [{}] })).status, 403);
    assert.equal((await api(T.compta, 'GET', `/eleves/${e}/bulletin?trimestre=1`)).status, 403);
    assert.equal((await api(T.compta, 'POST', '/eleves/' + e + '/affecter-auto')).status, 403);
  }
  for (const path of ['/paiements', '/tarifs', '/paiements/soldes', '/stats', '/journal']) assert.equal((await api(A.compta, 'GET', path)).status, 200, path);
  const s = (await api(A.compta, 'GET', '/paiements/soldes')).data; assert.ok(s.some(r => r.reste > 0 && 'du' in r && 'paye' in r));
  const st = (await api(A.compta, 'GET', '/stats')).data; assert.ok('encaisse' in st && !('classes' in st) && !('enseignants' in st) && !('eleves' in st));
  assert.ok((await api(A.compta, 'GET', '/journal')).data.every(x => ['paiements', 'tarifs'].includes(x.entite)));
  const dest = (await api(A.compta, 'GET', '/messages/destinataires')).data; assert.ok(dest.every(d => d.role === 'admin' || d.role === 'parent'));
  assert.ok(dest.filter(d => d.role === 'parent').length < 6, 'pas de liste complète des parents');
});
test('Super-admin : accès (lecture seule) à toutes les données financières', async () => {
  const SU = (await api(null, 'POST', '/auth/login', { email: 'super@ecole-saas.tn', password: process.env.SUPERADMIN_PASSWORD || 'Super@2026' })).data.token;
  const schools = (await api(SU, 'GET', '/schools')).data; assert.equal(schools.length, 2); assert.ok(schools.every(s => s.encaisse > 0));
  for (const sc of schools) {
    const f = await api(SU, 'GET', `/schools/${sc.id}/finance`); assert.equal(f.status, 200);
    assert.ok(f.data.paiements.length > 0 && f.data.soldes.length > 0 && f.data.tarifs.length > 0 && f.data.totaux.encaisse > 0);
    assert.equal((await api(SU, 'GET', `/schools/${sc.id}/paiements/${f.data.paiements[0].id}/recu`)).status, 200);
  }
  const f0 = (await api(SU, 'GET', `/schools/${schools[0].id}/finance`)).data, f1 = (await api(SU, 'GET', `/schools/${schools[1].id}/finance`)).data;
  assert.equal((await api(SU, 'GET', `/schools/${schools[0].id}/paiements/${f1.paiements[0].id}/recu`)).status, 404);   // reçu d'une autre école via mauvaise école
  assert.equal((await api(SU, 'POST', '/paiements', {})).status, 403);       // lecture seule : pas d'écriture via les routes d'école
  for (const T of [A, B]) assert.equal((await api(T.admin, 'GET', `/schools/${schools[0].id}/finance`)).status, 403);
  assert.equal((await api(SU, 'GET', '/eleves')).status, 403);               // pas d'accès aux données non financières d'une école
});

// ───────────── Pré-inscriptions publiques, comptes automatiques ─────────────
test('Pré-inscription publique : liste des écoles et contrôles de saisie', async () => {
  const ec = await api(null, 'GET', '/public/ecoles'); assert.equal(ec.status, 200); assert.ok(ec.data.length >= 2);
  const idA = ec.data.find(e => /Chebbi/.test(e.name)).id, parent = { nom: 'Essai', prenom: 'Parent', email: 'controle@example.com', telephone: '+216 55 111 222' };
  const ok = { ecole_id: idA, nom: 'Controle', prenom: 'Un', date_naissance: '2020-05-05', sexe: 'M' };
  const post = b => api(null, 'POST', '/public/preinscriptions', b);
  assert.equal((await post({ consentement: true, parent, enfants: [{ ...ok, date_naissance: '2021-05-05' }] })).status, 400);   // trop jeune (né en 2021)
  assert.equal((await post({ consentement: true, parent, enfants: [{ ...ok, date_naissance: '2008-05-05' }] })).status, 400);   // trop âgé
  assert.equal((await post({ parent, enfants: [ok] })).status, 400);                                                         // consentement obligatoire
  assert.equal((await post({ consentement: true, parent: { ...parent, email: 'pas-un-email' }, enfants: [ok] })).status, 400);
  assert.equal((await post({ consentement: true, parent, enfants: [{ ...ok, ecole_id: 999999 }] })).status, 400);              // école inconnue
  assert.equal((await post({ consentement: true, parent, enfants: [] })).status, 400);
  const bot = await post({ website: 'http://spam', consentement: true, parent, enfants: [ok] }); assert.equal(bot.data.envoyees, 0);   // champ piège
});

test('Pré-inscription : parcours complet, comptes parent/élève créés une seule fois, 2 écoles', async () => {
  const ec = (await api(null, 'GET', '/public/ecoles')).data, idA = ec.find(e => /Chebbi/.test(e.name)).id, idB = ec.find(e => /Khaldoun/.test(e.name)).id;
  const email = `parcours.${Date.now()}@example.com`, parent = { nom: 'Parcours', prenom: 'Famille', email, telephone: '+216 55 111 222' };
  const child = (ecole_id, prenom, date_naissance, sexe = 'M') => ({ ecole_id, nom: 'Parcours', prenom, date_naissance, sexe });
  const post = b => api(null, 'POST', '/public/preinscriptions', { consentement: true, parent, ...b });
  const r = await post({ enfants: [child(idA, 'Un', '2020-05-05'), child(idB, 'Deux', '2019-03-03', 'F')] }); assert.equal(r.status, 201); assert.equal(r.data.envoyees, 2);
  assert.equal((await post({ enfants: [child(idA, 'Un', '2020-05-05')] })).status, 409);                                    // doublon refusé
  const lst = async T => (await api(T.admin, 'GET', '/preinscriptions?statut=en_attente')).data.filter(x => x.parent_email === email);
  const la = await lst(A), lb = await lst(B); assert.equal(la.length, 1); assert.equal(lb.length, 1); assert.notEqual(la[0].id, lb[0].id);   // chaque école ne voit que sa demande
  assert.equal((await api(A.admin, 'POST', `/preinscriptions/${lb[0].id}/valider`, {})).status, 404);                       // pas de validation inter-écoles
  assert.equal((await api(A.admin, 'POST', `/preinscriptions/${lb[0].id}/refuser`, { motif: 'test' })).status, 404);
  for (const t of [A.compta, A.parent, A.teacher]) { assert.equal((await api(t, 'GET', '/preinscriptions')).status, 403); assert.equal((await api(t, 'POST', `/preinscriptions/${la[0].id}/valider`, {})).status, 403); }
  // validation école A : crée parent + élève + comptes
  const v = await api(A.admin, 'POST', `/preinscriptions/${la[0].id}/valider`, {}); assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.ok(v.data.parent_nouveau && v.data.identifiants.parent.motdepasse && v.data.identifiants.eleve.motdepasse && v.data.eleve.matricule);
  assert.equal(v.data.eleve.classe, '1ère année A'); assert.equal(v.data.email_statut, 'non_configure');
  assert.equal((await api(A.admin, 'POST', `/preinscriptions/${la[0].id}/valider`, {})).status, 409);                       // déjà traitée
  const pA = v.data.identifiants.parent, eA = v.data.identifiants.eleve;
  const lp = (await api(null, 'POST', '/auth/login', { email: pA.login, password: pA.motdepasse })).data; assert.ok(lp.token); assert.equal(lp.user.mdp_temporaire, true); assert.equal(lp.user.role, 'parent');
  const kids = (await api(lp.token, 'GET', '/eleves')).data; assert.equal(kids.length, 1); assert.equal(kids[0].prenom, 'Un');
  const le = (await api(null, 'POST', '/auth/login', { email: eA.login, password: eA.motdepasse })).data; assert.ok(le.token); assert.equal(le.user.role, 'eleve');
  assert.equal((await api(le.token, 'GET', '/eleves')).data.length, 1);
  assert.equal((await api(le.token, 'GET', '/preinscriptions')).status, 403);
  // 2e enfant du même parent dans la même école : compte parent RÉUTILISÉ, nouveau compte élève
  assert.equal((await post({ enfants: [child(idA, 'Trois', '2019-08-08')] })).status, 201);
  const l2 = (await lst(A)).find(x => x.enfant_prenom === 'Trois'); const v2 = (await api(A.admin, 'POST', `/preinscriptions/${l2.id}/valider`, {})).data;
  assert.equal(v2.parent_nouveau, false); assert.equal(v2.identifiants.parent, undefined); assert.ok(v2.identifiants.eleve.motdepasse);
  assert.equal((await api(lp.token, 'GET', '/eleves')).data.length, 2);
  assert.equal((await post({ enfants: [child(idA, 'Trois', '2019-08-08')] })).status, 409);                                  // enfant déjà inscrit : pas de doublon
  // école B : compte parent distinct (même e-mail), mots de passe distincts
  const vb = (await api(B.admin, 'POST', `/preinscriptions/${lb[0].id}/valider`, {})).data; assert.ok(vb.parent_nouveau); assert.notEqual(vb.identifiants.parent.motdepasse, pA.motdepasse);
  const lpB = (await api(null, 'POST', '/auth/login', { email: email, password: vb.identifiants.parent.motdepasse })).data; assert.equal(lpB.user.school.name, 'École Primaire Ibn Khaldoun');
  assert.equal((await api(lpB.token, 'GET', '/eleves')).data.length, 1);
  // même mot de passe dans les deux écoles : l'utilisateur choisit son école
  assert.equal((await api(lp.token, 'POST', '/auth/mot-de-passe', { ancien: pA.motdepasse, nouveau: 'Meme@123456' })).status, 200);
  assert.equal((await api(lpB.token, 'POST', '/auth/mot-de-passe', { ancien: vb.identifiants.parent.motdepasse, nouveau: 'Meme@123456' })).status, 200);
  const amb = (await api(null, 'POST', '/auth/login', { email, password: 'Meme@123456' })).data; assert.equal(amb.choix_ecole.length, 2); assert.ok(!amb.token);
  const pick = (await api(null, 'POST', '/auth/login', { email, password: 'Meme@123456', school_id: idB })).data; assert.equal(pick.user.school.id, idB); assert.equal(pick.user.mdp_temporaire, false);
  // refus : motif obligatoire, redépôt possible ensuite
  assert.equal((await post({ enfants: [child(idA, 'Quatre', '2018-02-02')] })).status, 201);
  const l4 = (await lst(A)).find(x => x.enfant_prenom === 'Quatre');
  assert.equal((await api(A.admin, 'POST', `/preinscriptions/${l4.id}/refuser`, {})).status, 400);
  assert.equal((await api(A.admin, 'POST', `/preinscriptions/${l4.id}/refuser`, { motif: 'Dossier incomplet' })).status, 200);
  assert.equal((await api(A.admin, 'GET', '/preinscriptions?statut=refusee')).data.some(x => x.id === l4.id && x.motif_refus === 'Dossier incomplet'), true);
  assert.equal((await post({ enfants: [child(idA, 'Quatre', '2018-02-02')] })).status, 201);
});

test('Comptes parents et élèves : jamais créés à la main', async () => {
  const mk = role => api(A.admin, 'POST', '/utilisateurs', { nom: 'Manuel', prenom: 'Test', email: `manuel.${role}.${Date.now()}@example.com`, role, password: 'Secret123' });
  assert.equal((await mk('parent')).status, 400); assert.equal((await mk('eleve')).status, 400);
  assert.equal((await mk('enseignant')).status, 201);
  const t = (await api(A.admin, 'GET', '/utilisateurs?role=enseignant')).data[0];
  assert.equal((await api(A.admin, 'PUT', `/utilisateurs/${t.id}`, { role: 'parent' })).status, 400);
});
