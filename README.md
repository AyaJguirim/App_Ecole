# 🎓 Application de gestion d'écoles primaires (SaaS multi-écoles)

Application web complète (PWA) conforme au cahier des charges *« Gestion d'école primaire »*, avec en plus
l'**isolation entre écoles** décrite dans le guide *« Isolation entre écoles »* : chaque donnée appartient à une
école (`school_id`) et l'utilisateur ne voit que les données de son école.

- **Frontend** : HTML / CSS / JavaScript (sans compilation), responsive, installable (PWA) — servi par Nginx
- **Backend** : Node.js 20 + Express, API REST — **PostgreSQL 16**
- **Sécurité** : JWT, mots de passe hachés (bcrypt), RBAC, Row Level Security PostgreSQL, journal d'actions, limitation des tentatives de connexion
- **Docker** : tout se lance avec une seule commande

```
app_ecole/
├── backend/            API Node.js (src/, tests/)
├── backups/            sauvegardes quotidiennes (+ scripts backup-now.sh / restore.sh)
├── db/                 schéma PostgreSQL (01-schema.sql) + rôle applicatif (02-roles.sh)
├── frontend/           interface web (public/) + nginx.conf
├── .env                configuration (secrets — non versionné)
├── .env.example        modèle de configuration
├── .gitignore
├── docker-compose.yml
└── README.md
```

## 1. Démarrage

Prérequis : Docker Desktop (ou Docker + Compose).

```bash
docker compose up -d --build
```

Puis ouvrir **http://localhost:8080** (port modifiable avec `APP_PORT` dans `.env`).
Au premier démarrage, la base est créée et remplie avec des données de démonstration (2 écoles fictives).

Arrêter : `docker compose down` · Tout réinitialiser (⚠️ efface les données) : `docker compose down -v`

## 2. Comptes de démonstration

Mot de passe de tous les comptes d'école : `Demo@2026` — super-administrateur : `super@ecole-saas.tn` / `Super@2026`

| Rôle | École A (Abou el Kacem Chebbi) | École B (Ibn Khaldoun) |
|---|---|---|
| Direction | admin@aboukacem.tn | admin@ibnkhaldoun.tn |
| Comptable | comptable@aboukacem.tn | comptable@ibnkhaldoun.tn |
| Enseignant | bensalah@aboukacem.tn, trabelsi@…, gharbi@… | chaabane@ibnkhaldoun.tn, mansouri@…, zouari@… |
| Parent | hammami@aboukacem.tn, jlassi@…, mejri@… | ayari@ibnkhaldoun.tn, baccouche@…, cherif@… |
| Élève | youssef.hammami@aboukacem.tn | — |

Chaque école contient : 4 classes, 7 matières, 4 salles, 12 élèves, grille tarifaire, paiements (soldés, partiels, impayés),
emploi du temps, évaluations et notes du 1er trimestre, absences, devoirs, messages et annonce.

**Pour démarrer en production sans données de démo** : mettez `SEED_DEMO=false` dans `.env` avant le premier lancement
(seul le super-administrateur est créé ; il crée ensuite les écoles depuis le menu « Écoles clientes »).

## 3. Fonctionnalités (cahier des charges)

| Module | Contenu |
|---|---|
| Rôles (RBAC) | Super-admin (SaaS), Direction, Comptable/Secrétariat, Enseignant, Parent, Élève |
| Inscriptions & dossiers | **Pré-inscription publique sans compte** (voir § 3 bis), validée par la direction, dossier complet (état civil, photo, parents, antécédents médicaux), affectation manuelle ou **automatique** selon l'âge, import/export CSV |
| Classes, matières, salles | CRUD complet, effectifs contrôlés, affectation enseignant ↔ matière ↔ classe |
| Emploi du temps | CRUD, **détection des conflits** (enseignant, classe, salle), vue calendrier par jour |
| Évaluations & notes | Saisie en masse, moyennes par matière et générale **pondérées par coefficients**, rang, bulletins PDF, absences justifiables par les parents |
| Paiements (réservés au **comptable**) | Grille tarifaire par année, paiements (espèces / virement / mobile money), solde, **impayés**, **relances** (manuelles + automatiques), **reçu PDF**, **message automatique au parent** après chaque paiement (montant, date, mode, solde, lien du reçu) + journal d'envoi. **La direction ne voit que « qui a payé / pas payé » (soldé, partiel, rien payé) : jamais les montants, reçus, tarifs ni journal financier** ; le parent voit les paiements de ses propres enfants |
| Devoirs | Création avec pièces jointes, dépôt élève (1 à 3 fichiers, remplaçable avant l'échéance, statut rendu/en retard/noté), notes + commentaires, correction visible après la date de remise, marquage « vu » par les parents, notifications |
| Messagerie | Enseignant ↔ parent (fil par élève), administration ↔ parents/élèves, brouillons, **messages envoyés immuables**, masquage côté destinataire, annonces immuables, historique réservé aux parties concernées, journalisation des consultations |
| Notifications | Dans l'application + notifications du navigateur (PWA) ; e-mail via SendGrid si `SENDGRID_API_KEY` est renseigné (sinon l'envoi est journalisé « non configuré ») |
| Traçabilité | Toute création / modification (anciennes et nouvelles valeurs) / suppression est journalisée ; suppression logique (soft delete) ; suppressions contrôlées |
| Années scolaires | `annee_scolaire` sur classes, évaluations, absences, paiements, tarifs ; bouton « Ouvrir l'année suivante » (copie des classes + promotion des élèves, historique conservé) |

## 3 bis. Pré-inscription et création automatique des comptes

Les comptes **parents** et **élèves** ne se créent jamais à la main : ils naissent de la validation d'une pré-inscription.

1. **Le parent (sans compte)** ouvre `/#/preinscription` (lien « Pré-inscrire mon enfant » sur la page de connexion), saisit ses coordonnées et, **pour chaque enfant, choisit l'école** parmi celles qui acceptent des demandes. Il peut déposer plusieurs enfants (même dans des écoles différentes) en une seule fois. Protection anti-spam : champ piège + limitation par adresse IP (`PUBLIC_RATE_LIMIT`).
2. **La direction** voit la demande dans **Pré-inscriptions** (elle ne voit que celles de son école), la vérifie, puis **valide** (classe choisie ou affectation automatique selon l'âge) ou **refuse** avec un motif (le parent est informé).
3. **À la validation**, le système crée automatiquement :
   - le **compte parent** — *une seule fois* : si l'e-mail a déjà un compte dans l'école, il est réutilisé ;
   - le **dossier élève** (matricule généré) et son **compte élève** — *une seule fois* : un enfant déjà inscrit n'est jamais dupliqué ;
   - puis envoie les **identifiants par e-mail** au parent (les deux comptes). Si l'envoi d'e-mails n'est pas configuré, la direction voit les identifiants **une seule fois** à l'écran (boutons « Copier ») pour les transmettre.
4. **Première connexion** : le mot de passe est temporaire, l'utilisateur est invité à le changer immédiatement.
5. **Un autre enfant plus tard** : le parent connecté utilise « Pré-inscrire un enfant » (même école ou autre école) et suit ses demandes dans **Mes demandes**.

Identifiant du compte élève : `<matricule>.<n° école>@eleve.local` (l'élève n'a pas de boîte e-mail ; les identifiants sont envoyés au parent).
**Parent dans deux écoles** : un compte par école avec le même e-mail ; si les deux mots de passe sont identiques, la connexion demande de choisir l'école.
Variables : `APP_URL` (adresse indiquée dans l'e-mail), `SENDGRID_API_KEY` / `MAIL_FROM` (envoi réel), `PUBLIC_RATE_LIMIT` (demandes publiques par heure et par IP, 100 par défaut).

**Mise à jour d'une base existante** (créée avant cette fonctionnalité) :
```powershell
docker compose up -d db
Get-Content db\migration_preinscriptions.sql | docker compose exec -T db psql -U ecole_admin -d ecole
docker compose up -d --build
```
Sur une base neuve, `db/01-schema.sql` contient déjà tout.

## 4. Contrôles de saisie (exemples)

Appliqués **côté serveur** (source de vérité) et rappelés côté navigateur (attributs `min`, `max`, `pattern`, `required`) :

- **Âge** : un élève de 1ère année doit avoir 6 ans (né en **2020** ou avant pour 2026-2027). Niveau *n* : né en `S-5-n` ou avant ; retard maximal toléré 3 ans ; âge maximal 14 ans. Date de naissance jamais dans le futur.
- **Noms/prénoms** : lettres, espaces, apostrophes, tirets (2 à 60 caractères). **E-mail** valide et unique dans toute la base. **Téléphone** : 8 à 15 chiffres.
- **Mot de passe** : 8 caractères minimum avec lettre + chiffre (haché en bcrypt).
- **Classe** : capacité 5 à 40, doublon (niveau + section + année) refusé, capacité non réductible sous l'effectif, classe pleine refusée à l'affectation.
- **Matière** : coefficient 0,5 à 10 ; matière réservée à un niveau → uniquement les classes de ce niveau.
- **Emploi du temps** : 07:30–18:00, durée ≥ 15 min, conflits refusés, enseignant affecté obligatoire, salle disponible et assez grande.
- **Notes** : entre 0 et le barème (2 décimales max) ; barème non réductible sous une note existante.
- **Paiements** : montant > 0, jamais supérieur au solde restant, date non future, référence obligatoire hors espèces, n° de reçu unique par école.
- **Devoirs** : date de remise non passée, note ≤ barème, fichiers PDF/images/Word/Excel/texte uniquement (5 Mo max) ; type vérifié par l'extension.
- **Suppressions** : refusées si l'élément est utilisé (classe avec élèves, matière avec notes…) ; devoir avec dépôts : confirmation explicite.

## 5. Isolation entre écoles (guide Word)

| Étape du guide | Mise en œuvre |
|---|---|
| `schools` + `school_id` partout | `db/01-schema.sql` (statut, formule, fin d'abonnement ; école suspendue/expirée = connexion refusée) |
| L'école vient de la connexion | L'école est lue en base à partir du **jeton signé** ; aucun paramètre `school_id` du navigateur n'est jamais utilisé |
| Filtre en un seul endroit | `backend/src/db.js` (helpers `find/insert/update`) + `crud.js` : `school_id` ajouté automatiquement |
| 2ᵉ barrière PostgreSQL | **Row Level Security** sur toutes les tables ; l'API se connecte avec un rôle non propriétaire (`app_user`) qui ne voit que l'école de la transaction |
| Liens avec numéro (`/eleve/124`) | Réponse **404** pour tout élément d'une autre école |
| Fichiers | Dossier par école, accès contrôlé au cas par cas (photo, devoir, correction, dépôt, pièce de message) |
| Exports, statistiques, recherche | Mêmes filtres |
| Tâches de fond (relances) | Reçoivent l'école explicitement |
| Doublons | Matricule, n° de reçu et e-mail uniques **par école** (un parent ayant des enfants dans 2 écoles a un compte dans chacune) |
| Super-administrateur | Compte sans école, séparé des directeurs ; ne peut pas lire les données d'une école |
| Tests | `backend/tests/isolation.test.js` : écoles A↔B dans les deux sens (listes, accès direct, modification, suppression, reçus, bulletins, notes, dépôts, rattachements croisés, messagerie…) |

Lancer les tests (application démarrée, base de démonstration neuve) :

```bash
docker compose exec backend npm test
```

> Si vous avez modifié les données de démonstration, réinitialisez : `docker compose down -v && docker compose up -d --build`.

## 6. Sauvegardes

Le service `backup` réalise **un `pg_dump` compressé par jour** dans `./backups` et supprime ceux de plus de **30 jours**.
Sauvegarde immédiate : `./backups/backup-now.sh` — Restauration : `./backups/restore.sh backups/ecole_XXXX.sql.gz`.
Les fichiers téléversés (photos, devoirs) sont dans le volume Docker `uploads` : sauvegardez-le aussi
(`docker run --rm -v app_ecole_uploads:/d -v "$PWD/backups":/b alpine tar czf /b/uploads.tgz -C /d .`).

## 7. Mise en ligne (cahier des charges, partie IV)

| Option | Usage | Démarche |
|---|---|---|
| A. Cloudflare Quick Tunnel | Démonstration | `docker compose up -d` puis `cloudflared tunnel --url http://localhost:8080` → URL `*.trycloudflare.com` temporaire |
| B. Railway / Render / Zeabur | Production simple | Pousser le dépôt sur GitHub, créer 3 services depuis les dossiers `backend` et `frontend` + PostgreSQL managé (exécuter `db/01-schema.sql` puis créer le rôle `app_user` comme dans `db/02-roles.sh`), définir les variables de `.env` |
| C. Nom de domaine + hébergeur | Professionnel | Option B + domaine (CNAME/A) + HTTPS automatique (Let's Encrypt) |
| D. VPS (OVH, AWS…) | Contrôle total | Installer Docker, copier le projet, `docker compose up -d --build`, placer Nginx/Caddy en reverse proxy HTTPS devant le port 8080 |

**Avant la mise en production — checklist :**
1. Modifier **tous les secrets** de `.env` (`POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `JWT_SECRET` ≥ 32 caractères aléatoires, `SUPERADMIN_PASSWORD`) **avant le premier lancement**.
2. `SEED_DEMO=false` pour ne pas créer les comptes de démonstration.
3. Activer HTTPS (obligatoire : données d'enfants, RGPD) et décommenter l'en-tête `Strict-Transport-Security` dans `frontend/nginx.conf`.
4. Renseigner `SENDGRID_API_KEY` et `MAIL_FROM` pour les e-mails réels.
5. Prévoir la sauvegarde hors serveur du dossier `backups/` et du volume `uploads`.
6. Ne jamais publier `.env` (il est dans `.gitignore`).

## 8. Développement local (sans Docker)

```bash
# PostgreSQL local : créer la base, exécuter db/01-schema.sql puis db/02-roles.sh (avec APP_DB_PASSWORD)
cd backend && npm install
export DATABASE_URL=postgres://app_user:MOTDEPASSE@localhost:5432/ecole JWT_SECRET=une-longue-chaine-secrete-0123456789 UPLOAD_DIR=./uploads
npm start            # API sur http://localhost:4000
# servir frontend/public avec un serveur statique qui proxifie /api vers http://localhost:4000
```

## 9. Interface (design system)

L'interface suit les recommandations UI/UX Pro Max : elle reste en HTML / CSS / JavaScript natif (sans compilation ni dépendance externe) et s'appuie sur un design system documenté dans `frontend/public/style.css`.

| Élément | Détail |
|---|---|
| Identité | Palette indigo / ardoise, couleurs sémantiques (succès, alerte, erreur, info), polices Inter + Plus Jakarta Sans **hébergées localement** |
| Thèmes | Clair et sombre conçus ensemble ; bouton dans la barre du haut ; préférence mémorisée, sinon celle du système |
| Icônes | Un seul jeu cohérent (Phosphor, SVG intégrés) : plus aucun émoji utilisé comme icône |
| Navigation | Menu latéral groupé avec page active signalée ; menu coulissant sur mobile ; menu utilisateur et notifications accessibles au clavier |
| Formulaires | Libellés visibles, champs obligatoires signalés, message d'erreur précis **sous chaque champ**, résumé d'erreurs, bouton de chargement, avertissement avant d'abandonner une saisie |
| Tableaux | En-tête figé, survol, recherche ; **transformés en cartes sur téléphone** ; états vides explicites |
| Fenêtres | Piège de focus, retour du focus, fermeture par Échap, feuille basse sur mobile |
| Accessibilité | Contrastes ≥ 4,5:1 vérifiés, focus visible, cibles tactiles ≥ 44 px, `prefers-reduced-motion`, repères de page (`main`, `nav`), audit axe-core WCAG 2.2 AA : 0 violation |
| Responsive | Ordinateur, tablette et téléphone ; cartes de statistiques et grilles adaptatives |

Les polices et icônes sont sous licences libres (voir `frontend/public/fonts/LICENSES.txt`).

## 10. Périmètre et choix techniques

- **Multi-écoles** : le cahier des charges initial décrivait un déploiement mono-école ; conformément au guide Word fourni, l'application est multi-écoles. Une seule école peut très bien l'utiliser (une seule ligne dans `schools`).
- **Notifications push** : notifications du navigateur (API Notification) alimentées par l'API ; l'intégration Firebase Cloud Messaging (mobile) fait partie de la V2.
- Hors périmètre (V2) : application native, bibliothèque, transport/cantine, évaluation par compétences, visioconférence, interface en anglais.
- Les montants sont en dinars tunisiens (TND).
