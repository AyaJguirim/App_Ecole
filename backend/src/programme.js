// Matières créées automatiquement pour une nouvelle école (programme du primaire tunisien — à valider/ajuster).
// [nom, coefficient, niveaux concernés]
const TOUS = [1, 2, 3, 4, 5, 6];
const PROGRAMME = [
  ["Arabe", 3, TOUS],
  ["Mathématiques", 3, TOUS],
  ["Français", 3, [2, 3, 4, 5, 6]],
  ["Éveil scientifique", 2, TOUS],
  ["Éducation islamique", 1, TOUS],
  ["Éducation civique", 1, TOUS],
  ["Histoire-Géographie", 1, [3, 4, 5, 6]],
  ["Anglais", 1.5, [3, 4, 5, 6]],
  ["Éducation technologique", 1, [3, 4, 5, 6]],
  ["Informatique", 1, [5, 6]],
  ["Éducation musicale", 1, TOUS],
  ["Éducation plastique", 1, TOUS],
  ["Éducation physique", 1, TOUS],
];

// Une matière « niveau = NULL » vaut pour tous les niveaux ; sinon une ligne par niveau (contrainte de l'application)
async function creerMatieres(db, schoolId) {
  const ins = (nom, coef, niv) =>
    db.q(
      "INSERT INTO matieres (school_id,nom,coefficient,niveau) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [schoolId, nom, coef, niv],
    );
  for (const [nom, coef, niveaux] of PROGRAMME) {
    if (niveaux.length === 6) await ins(nom, coef, null);
    else for (const n of niveaux) await ins(nom, coef, n);
  }
}

async function creerSalles(db, schoolId, nb, capacite = 25) {
  for (let i = 1; i <= nb; i++)
    await db.q(
      "INSERT INTO salles (school_id,nom,capacite) VALUES ($1,$2,$3)",
      [schoolId, `Salle ${i}`, capacite],
    );
}
module.exports = { PROGRAMME, creerMatieres, creerSalles };
