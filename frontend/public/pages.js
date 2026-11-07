// Pages de l'application (chaque page = une fonction qui remplit <main>).
"use strict";
(() => {
  const {
    $,
    $$,
    esc,
    S,
    api,
    download,
    toast,
    modal,
    fdate,
    fdt,
    money,
    niv,
    classe,
    has,
    badge,
    opts,
    formHtml,
    readForm,
    field,
  } = APP;
  const P = APP.PAGES;
  const ic = APP.icon,
    ib = (n, t, s = 18) => `${APP.icon(n, s)} ${t}`; // icône + libellé
  const ALL = ["admin", "comptable", "enseignant", "parent", "eleve"];
  const nav = (id, label, icon, roles, group = "") =>
    APP.NAV.push({ id, label, icon, roles, group });
  const NIV = [1, 2, 3, 4, 5, 6].map((n) => ({ v: n, l: niv(n) }));
  const MODES = {
    especes: "Espèces",
    virement: "Virement",
    mobile_money: "Mobile money",
  };
  const clsLabel = (c) => `${niv(c.niveau)} ${c.section} (${c.annee_scolaire})`;
  const clsOpts = () => opts("/classes?annee_scolaire=" + APP.year(), clsLabel);
  const eleveLabel = (e) => `${e.nom} ${e.prenom} — ${e.matricule}`;
  const today = () => new Date().toISOString().slice(0, 10);
  const initials = (e) => esc((e.prenom?.[0] || "") + (e.nom?.[0] || ""));

  nav("accueil", "Accueil", "house", ["superadmin", ...ALL]);
  nav("ecoles", "Écoles clientes", "buildings", ["superadmin"]);
  nav(
    "eleves",
    "Élèves",
    "student",
    ["admin", "enseignant", "parent", "eleve"],
    "Scolarité",
  );
  nav(
    "preinscriptions",
    "Pré-inscriptions",
    "user-plus",
    ["admin"],
    "Scolarité",
  );
  nav("mesdemandes", "Mes demandes", "hourglass", ["parent"], "Scolarité");
  nav("classes", "Classes", "users", ["admin", "enseignant"], "Scolarité");
  nav("matieres", "Matières", "books", ["admin", "enseignant"], "Scolarité");
  nav("affectations", "Affectations", "link-simple", ["admin"], "Scolarité");
  nav(
    "edt",
    "Emploi du temps",
    "calendar-blank",
    ["admin", "enseignant", "parent", "eleve"],
    "Scolarité",
  );
  nav("creneaux", "Gérer les créneaux", "clock", ["admin"], "Scolarité");
  nav(
    "evaluations",
    "Évaluations & notes",
    "pencil-simple-line",
    ["admin", "enseignant"],
    "Pédagogie",
  );
  nav(
    "mesnotes",
    "Notes & bulletins",
    "graduation-cap",
    ["parent", "eleve"],
    "Pédagogie",
  );
  nav(
    "absences",
    "Absences",
    "calendar-x",
    ["admin", "enseignant", "parent", "eleve"],
    "Pédagogie",
  );
  nav(
    "devoirs",
    "Devoirs",
    "clipboard-text",
    ["admin", "enseignant", "parent", "eleve"],
    "Pédagogie",
  );
  nav(
    "paiements",
    "Paiements",
    "credit-card",
    ["comptable", "parent"],
    "Finances",
  );
  nav("recus", "Reçus de paiement", "receipt", ["admin"], "Finances");
  nav("finance", "Finances des écoles", "coins", ["superadmin"]);
  nav("impayes", "Qui a payé ?", "wallet", ["admin", "comptable"], "Finances");
  nav("tarifs", "Grille tarifaire", "tag", ["comptable"], "Finances");
  nav("messages", "Messagerie", "envelope-simple", ALL, "Communication");
  nav(
    "enseignants",
    "Enseignants",
    "chalkboard-teacher",
    ["admin"],
    "Administration",
  );
  nav("parents", "Parents", "users-three", ["admin"], "Administration");
  nav(
    "comptes",
    "Tous les comptes",
    "identification-card",
    ["admin"],
    "Administration",
  );
  nav("salles", "Salles", "door", ["admin"], "Administration");
  nav(
    "journal",
    "Journal d'actions",
    "scroll",
    ["admin", "comptable"],
    "Administration",
  );
  nav("ecole", "Paramètres & année", "gear-six", ["admin"], "Administration");
  nav("profil", "Mon profil", "user-circle", ["superadmin", ...ALL], "Compte");

  // ═════════ Composant générique : liste + ajout / modification / suppression ═════════
  function resource(cfg) {
    return async (main) => {
      const base = cfg.base || cfg.path.split("?")[0],
        canW = !!cfg.write && has(...cfg.write),
        delRoles = cfg.del || cfg.write,
        canD = !!delRoles && has(...delRoles);
      let rows = [],
        q = "",
        year = cfg.year ? APP.year() : null;
      const url = () =>
        cfg.path +
        (year
          ? (cfg.path.includes("?") ? "&" : "?") + "annee_scolaire=" + year
          : "");
      const yrs = [];
      if (year)
        for (let y = APP.startYear() + 1; y >= APP.startYear() - 3; y--)
          yrs.push(`${y}-${y + 1}`);
      main.innerHTML = `<div class="page-head"><div><h1>${cfg.title}</h1>${cfg.sub ? `<p class="page-sub">${cfg.sub}</p>` : ""}</div><div class="actions" id="tb"></div></div>
      <div class="card flush"><div class="toolbar"><div class="row" style="flex:1"><div class="search">${ic("magnifying-glass", 18)}<input id="q" type="search" placeholder="Rechercher…" aria-label="Rechercher dans la liste"></div>
      ${year ? `<select id="yr" aria-label="Année scolaire" style="width:auto">${yrs.map((y) => `<option${y === year ? " selected" : ""}>${y}</option>`).join("")}</select>` : ""}</div><span class="mut sm" id="cnt" aria-live="polite"></span></div><div class="wrap" id="tbl"></div></div>`;
      const tb = $("#tb", main);
      if (canW && !cfg.noAdd) {
        const b = document.createElement("button");
        b.className = "btn";
        b.innerHTML = ib("plus", cfg.addLabel || "Ajouter");
        b.onclick = () => openForm();
        tb.appendChild(b);
      }
      if (cfg.toolbar) cfg.toolbar(tb, load, main);
      const acts = (cfg.actions || []).filter(
        (a) => !a.roles || has(...a.roles),
      );
      function draw() {
        const t = q.toLowerCase(),
          list = rows.filter(
            (r) =>
              !t ||
              cfg.cols
                .map((c) => String(c.v(r)))
                .join(" ")
                .toLowerCase()
                .includes(t),
          );
        $("#cnt", main).textContent =
          `${list.length} élément${list.length > 1 ? "s" : ""}`;
        $("#tbl", main).innerHTML = list.length
          ? `<table class="tbl stack"><thead><tr>${cfg.cols.map((c) => `<th scope="col">${c.h}</th>`).join("")}<th scope="col"><span class="sr">Actions</span></th></tr></thead><tbody>${list
              .map(
                (
                  r,
                ) => `<tr>${cfg.cols.map((c) => `<td data-label="${esc(c.h)}"${!c.html && String(c.v(r)).length <= 24 ? ' class="nw"' : ""}>${c.html ? c.v(r) : esc(c.v(r))}</td>`).join("")}<td class="act"><div class="acts">
        ${acts
          .filter((a) => !a.show || a.show(r))
          .map(
            (a) =>
              `<button class="btn sec sm" data-a="${acts.indexOf(a)}" data-id="${r.id}">${a.l}</button>`,
          )
          .join("")}
        ${canW && !(cfg.noEdit && cfg.noEdit(r)) ? `<button class="btn sec sm icon" data-edit="${r.id}" title="Modifier" aria-label="Modifier ${esc(cfg.name ? cfg.name(r) : cfg.singular)}">${ic("pencil-simple", 16)}</button>` : ""}${canD && !(cfg.noDel && cfg.noDel(r)) ? `<button class="btn bad sm icon" data-del="${r.id}" title="Supprimer" aria-label="Supprimer ${esc(cfg.name ? cfg.name(r) : cfg.singular)}">${ic("trash", 16)}</button>` : ""}</div></td></tr>`,
              )
              .join("")}</tbody></table>`
          : APP.empty(
              q ? "Aucun résultat" : "Rien à afficher pour le moment",
              q
                ? "Essayez avec d'autres mots-clés."
                : canW && !cfg.noAdd
                  ? "Utilisez le bouton « Ajouter » pour créer le premier élément."
                  : "",
              q ? "magnifying-glass" : "tray",
            );
        APP.hydrateImages(main);
      }
      async function load() {
        rows = await api("GET", url());
        draw();
      }
      async function openForm(row, defaults) {
        const fields = await cfg.fields(row),
          vals = row
            ? { ...row }
            : { ...(cfg.defaults ? cfg.defaults() : {}), ...defaults };
        const m = modal(
          (row ? "Modifier" : "Ajouter") + " — " + cfg.singular,
          formHtml(fields, vals) +
            (cfg.note ? `<p class="mut sm">${cfg.note}</p>` : ""),
          {
            onSubmit: async (f) => {
              let b = readForm(f, fields);
              if (cfg.fixed) Object.assign(b, cfg.fixed);
              if (cfg.toPayload) b = cfg.toPayload(b, !row);
              const res = row
                ? await api("PUT", `${base}/${row.id}`, b)
                : await api("POST", base, b);
              if (cfg.after) await cfg.after(res, f, !row);
              toast(row ? "Modification enregistrée" : "Ajout effectué", "ok");
              await load();
            },
          },
        );
        cfg.onForm?.(m, row);
      }
      $("#q", main).oninput = (e) => {
        q = e.target.value;
        draw();
      };
      if ($("#yr", main))
        $("#yr", main).onchange = (e) => {
          year = e.target.value;
          load();
        };
      main.addEventListener("click", async (e) => {
        const b = e.target.closest(
          "button[data-a],button[data-edit],button[data-del]",
        );
        if (!b) return;
        const row = rows.find(
          (r) =>
            String(r.id) === (b.dataset.id || b.dataset.edit || b.dataset.del),
        );
        if (!row) return;
        try {
          if (b.dataset.edit) openForm(row);
          else if (b.dataset.a !== undefined)
            await acts[b.dataset.a].fn(row, load, main);
          else if (
            b.dataset.del &&
            (await APP.confirm(
              `Supprimer « ${cfg.name ? cfg.name(row) : cfg.singular} » ?`,
              "Supprimer",
            ))
          ) {
            try {
              await api("DELETE", `${base}/${row.id}`);
            } catch (x) {
              if (
                x.status === 409 &&
                cfg.forceDelete &&
                (await APP.confirm(x.message))
              )
                await api("DELETE", `${base}/${row.id}?force=1`);
              else throw x;
            }
            toast("Suppression effectuée", "ok");
            await load();
          }
        } catch (x) {
          toast(x.message, "bad");
        }
      });
      await load();
      if (cfg.onLoaded) cfg.onLoaded({ openForm, rows });
    };
  }
  const col = (h, v, html) => ({ h, v, html });

  // ═════════ Utilisateurs ═════════
  const userFields = (role, fixedRole) => async (row) => [
    { k: "nom", l: "Nom", req: true, maxlength: 60 },
    { k: "prenom", l: "Prénom", req: true, maxlength: 60 },
    {
      k: "email",
      l: "E-mail (identifiant de connexion)",
      t: "email",
      req: true,
      maxlength: 200,
    },
    {
      k: "telephone",
      l: "Téléphone",
      t: "tel",
      pattern: "\\+?[0-9][0-9 ]{7,17}",
      title: "8 à 15 chiffres, espaces et + autorisés",
      ph: "+216 98 123 456",
    },
    ...(fixedRole
      ? []
      : [
          {
            k: "role",
            l: "Rôle",
            t: "select",
            req: true,
            o: (row && ["parent", "eleve"].includes(row.role)
              ? [row.role]
              : ["admin", "comptable", "enseignant"]
            ).map((r) => ({ v: r, l: APP.ROLES[r] })),
            help: "Les comptes parents et élèves sont créés automatiquement à la validation d'une pré-inscription.",
          },
        ]),
    {
      k: "password",
      l: row
        ? "Nouveau mot de passe (laisser vide pour conserver)"
        : "Mot de passe",
      t: "password",
      req: !row,
      minlength: 8,
      maxlength: 72,
      help: "8 caractères minimum, avec au moins une lettre et un chiffre",
      pattern: "(?=.*[A-Za-z])(?=.*[0-9]).{8,72}",
      title: "8 caractères minimum avec lettre et chiffre",
    },
    { k: "actif", l: "Compte actif", t: "checkbox" },
  ];
  const userCols = [
    col("Nom", (u) => `${u.nom} ${u.prenom}`),
    col("E-mail", (u) => u.email),
    col("Téléphone", (u) => u.telephone || "—"),
    col("Rôle", (u) => APP.ROLES[u.role]),
    col(
      "Statut",
      (u) => (u.actif ? badge("Actif", "ok") : badge("Désactivé", "bad")),
      true,
    ),
  ];
  const users = (title, singular, path, role, extra = {}) =>
    resource({
      ...extra,
      title,
      singular,
      path,
      base: "/utilisateurs",
      write: ["admin"],
      cols: userCols,
      fields: userFields(role, !!role),
      defaults: () => ({ actif: true, role }),
      fixed: role ? { role } : undefined,
      name: (u) => u.nom + " " + u.prenom,
      addLabel: "Ajouter",
    });
  P.enseignants = users(
    "Enseignants",
    "enseignant",
    "/utilisateurs?role=enseignant",
    "enseignant",
  );
  P.parents = users(
    "Parents / tuteurs",
    "parent",
    "/utilisateurs?role=parent",
    "parent",
    {
      noAdd: true,
      sub: "Les comptes parents sont créés automatiquement lorsque vous validez une demande de pré-inscription. Vous pouvez ici les modifier, réinitialiser leur mot de passe ou les désactiver.",
    },
  );
  P.comptes = users("Tous les comptes", "compte", "/utilisateurs", undefined, {
    sub: "Création manuelle réservée au personnel (direction, comptabilité, enseignants). Parents et élèves : voir « Pré-inscriptions ».",
  });

  // ═════════ Classes, matières, salles, affectations, tarifs ═════════
  P.classes = resource({
    title: "Classes",
    singular: "classe",
    path: "/classes",
    year: true,
    write: ["admin"],
    name: (c) => `${niv(c.niveau)} ${c.section}`,
    cols: [
      col("Classe", (c) => `${niv(c.niveau)} ${c.section}`),
      col("Année", (c) => c.annee_scolaire),
      col(
        "Effectif",
        (c) =>
          `<b>${c.effectif}</b> / ${c.capacite}<div class="bar"><i class="${c.effectif >= c.capacite ? "full" : ""}" style="width:${Math.min(100, (c.effectif / c.capacite) * 100)}%"></i></div>`,
        true,
      ),
      col("Titulaire", (c) => c.enseignant || "—"),
    ],
    defaults: () => ({ capacite: 25 }),
    fields: async (row) => [
      { k: "niveau", l: "Niveau", t: "select", req: true, o: NIV },
      {
        k: "section",
        l: "Section (A, B…)",
        req: true,
        maxlength: 3,
        pattern: "[A-Za-z0-9]{1,3}",
        title: "1 à 3 lettres ou chiffres",
      },
      {
        k: "capacite",
        l: "Capacité maximale",
        t: "number",
        req: true,
        min: 5,
        max: 40,
        step: 1,
        help: "Entre 5 et 40 élèves",
      },
      {
        k: "enseignant_id",
        l: "Enseignant titulaire",
        t: "select",
        empty: "— Aucun —",
        o: await opts(
          "/utilisateurs?role=enseignant&actif=true",
          (u) => `${u.nom} ${u.prenom}`,
        ),
      },
    ],
  });
  P.matieres = resource({
    title: "Matières",
    singular: "matière",
    path: "/matieres",
    write: ["admin"],
    name: (m) => m.nom,
    cols: [
      col("Matière", (m) => m.nom),
      col("Coefficient", (m) => String(m.coefficient).replace(".", ",")),
      col("Niveau", (m) => (m.niveau ? niv(m.niveau) : "Tous les niveaux")),
    ],
    fields: async () => [
      {
        k: "nom",
        l: "Nom de la matière",
        req: true,
        maxlength: 80,
        minlength: 2,
      },
      {
        k: "coefficient",
        l: "Coefficient",
        t: "number",
        req: true,
        min: 0.5,
        max: 10,
        step: 0.5,
        help: "Entre 0,5 et 10",
      },
      {
        k: "niveau",
        l: "Niveau concerné",
        t: "select",
        empty: "Tous les niveaux",
        o: NIV,
      },
    ],
  });
  P.salles = resource({
    title: "Salles",
    singular: "salle",
    path: "/salles",
    write: ["admin"],
    name: (s) => s.nom,
    defaults: () => ({ disponible: true, capacite: 25 }),
    cols: [
      col("Salle", (s) => s.nom),
      col("Capacité", (s) => s.capacite),
      col(
        "Disponibilité",
        (s) =>
          s.disponible
            ? badge("Disponible", "ok")
            : badge("Indisponible", "bad"),
        true,
      ),
    ],
    fields: async () => [
      { k: "nom", l: "Nom", req: true, maxlength: 60 },
      {
        k: "capacite",
        l: "Capacité",
        t: "number",
        req: true,
        min: 1,
        max: 100,
        step: 1,
      },
      { k: "disponible", l: "Disponible", t: "checkbox" },
    ],
  });
  P.affectations = resource({
    title: "Affectations enseignant ↔ matière ↔ classe",
    singular: "affectation",
    path: "/affectations",
    write: ["admin"],
    noEdit: () => true,
    name: (a) => `${a.enseignant} / ${a.matiere}`,
    cols: [
      col("Enseignant", (a) => a.enseignant),
      col("Matière", (a) => a.matiere),
      col("Classe", (a) => a.classe),
    ],
    fields: async () => [
      {
        k: "enseignant_id",
        l: "Enseignant",
        t: "select",
        req: true,
        o: await opts(
          "/utilisateurs?role=enseignant&actif=true",
          (u) => `${u.nom} ${u.prenom}`,
        ),
      },
      {
        k: "matiere_id",
        l: "Matière",
        t: "select",
        req: true,
        o: await opts(
          "/matieres",
          (m) => m.nom + (m.niveau ? ` (${niv(m.niveau)})` : ""),
        ),
      },
      {
        k: "classe_id",
        l: "Classe",
        t: "select",
        req: true,
        o: await clsOpts(),
      },
    ],
    note: "Une matière réservée à un niveau ne peut être affectée qu'aux classes de ce niveau.",
  });
  P.tarifs = resource({
    title: "Grille tarifaire",
    singular: "tarif",
    path: "/tarifs",
    year: true,
    write: ["comptable"],
    name: (t) => t.libelle,
    cols: [
      col("Libellé", (t) => t.libelle),
      col("Année", (t) => t.annee_scolaire),
      col("Montant", (t) => money(t.montant)),
    ],
    fields: async () => [
      {
        k: "libelle",
        l: "Libellé (inscription, tranche…)",
        req: true,
        minlength: 3,
        maxlength: 100,
      },
      {
        k: "montant",
        l: "Montant (TND)",
        t: "number",
        req: true,
        min: 0.01,
        max: 100000,
        step: 0.01,
      },
      {
        k: "annee_scolaire",
        l: "Année scolaire",
        req: true,
        pattern: "[0-9]{4}-[0-9]{4}",
        title: "Format 2026-2027",
      },
    ],
    defaults: () => ({ annee_scolaire: APP.year() }),
  });

  // ═════════ Élèves ═════════
  const eleveFields = async (row) => {
    const S0 = APP.startYear();
    return [
      { k: "nom", l: "Nom", req: true, maxlength: 60 },
      { k: "prenom", l: "Prénom", req: true, maxlength: 60 },
      {
        k: "date_naissance",
        l: "Date de naissance",
        t: "date",
        req: true,
        min: `${S0 - 14}-01-01`,
        max: `${S0 - 6}-12-31`,
        help: `Âge minimum 6 ans : né en ${S0 - 6} ou avant (1ère année), 14 ans maximum`,
      },
      {
        k: "sexe",
        l: "Sexe",
        t: "select",
        req: true,
        o: [
          { v: "M", l: "Garçon" },
          { v: "F", l: "Fille" },
        ],
      },
      {
        k: "classe_id",
        l: "Classe",
        t: "select",
        empty: "— Non affecté —",
        o: (await api("GET", "/classes?annee_scolaire=" + APP.year())).map(
          (c) => ({
            v: c.id,
            l: `${niv(c.niveau)} ${c.section} (${c.effectif}/${c.capacite})`,
          }),
        ),
      },
      {
        k: "parent_id",
        l: "Parent / tuteur",
        t: "select",
        empty: "— Aucun —",
        o: [
          { v: "__new__", l: "➕ Créer un nouveau parent…" },
          ...(await opts(
            "/utilisateurs?role=parent",
            (u) => `${u.nom} ${u.prenom}`,
          )),
        ],
      },
      { k: "np_nom", l: "Nom du parent", req: true, maxlength: 60 },
      { k: "np_prenom", l: "Prénom du parent", req: true, maxlength: 60 },
      {
        k: "np_email",
        l: "E-mail du parent",
        t: "email",
        req: true,
        maxlength: 200,
        help: "Les identifiants de connexion seront envoyés à cette adresse",
      },
      {
        k: "np_telephone",
        l: "Téléphone du parent",
        t: "tel",
        req: true,
        pattern: "\\+?[0-9][0-9 ]{7,17}",
        title: "8 à 15 chiffres",
        ph: "+216 98 123 456",
      },
      {
        k: "statut",
        l: "Statut",
        t: "select",
        req: true,
        o: [
          { v: "inscrit", l: "Inscrit" },
          { v: "preinscrit", l: "Pré-inscrit (à valider)" },
        ],
      },
      {
        k: "matricule",
        l: "Matricule",
        maxlength: 20,
        pattern: "[A-Za-z0-9-]{3,20}",
        help: "Laisser vide pour une génération automatique",
      },
      {
        k: "annee_entree",
        l: "Année d'entrée",
        t: "number",
        min: 2000,
        max: S0,
        step: 1,
      },
      { k: "adresse", l: "Adresse", maxlength: 255, full: true },
      {
        k: "antecedents_medicaux",
        l: "Antécédents médicaux",
        t: "textarea",
        maxlength: 1000,
        full: true,
      },
    ];
  };
  function parseCsv(text) {
    text = text.replace(/^\ufeff/, "");
    const first = text.split(/\r?\n/)[0],
      d =
        (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length
          ? ";"
          : ",";
    const out = [];
    let row = [],
      cur = "",
      q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            cur += '"';
            i++;
          } else q = false;
        } else cur += c;
      } else if (c === '"') q = true;
      else if (c === d) {
        row.push(cur);
        cur = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cur);
        out.push(row);
        row = [];
        cur = "";
      } else cur += c;
    }
    if (cur || row.length) {
      row.push(cur);
      out.push(row);
    }
    const head = out
      .shift()
      .map((h) => h.trim().toLowerCase().replace(/[éè]/g, "e"));
    return out
      .filter((r) => r.some((x) => x.trim()))
      .map((r) =>
        Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])),
      );
  }
  async function bulletinModal(e) {
    const m = modal(
      `Notes et bulletin — ${e.prenom} ${e.nom}`,
      '<div id="bl"></div>',
      { wide: true },
    );
    const show = async (t) => {
      const b = await api("GET", `/eleves/${e.id}/bulletin?trimestre=${t}`),
        notes = await api("GET", `/eleves/${e.id}/notes`);
      $("#bl", m).innerHTML =
        `<div class="tabs">${[1, 2, 3].map((i) => `<button type="button" data-t="${i}" class="${i === t ? "on" : ""}">Trimestre ${i}</button>`).join("")}</div>
      <div class="row sp"><div><b>${esc(b.classe || "—")}</b> · année ${esc(b.annee)}</div><button type="button" class="btn sm" id="pdfb">${ib("file-pdf", "Télécharger le bulletin PDF", 16)}</button></div>
      <div class="wrap"><table class="tbl"><thead><tr><th>Matière</th><th>Coef.</th><th>Moyenne /20</th><th>Moy. classe</th></tr></thead><tbody>${b.matieres.map((x) => `<tr><td>${esc(x.matiere)}</td><td>${x.coefficient}</td><td><b>${x.moyenne.toFixed(2)}</b></td><td>${x.moyenne_classe?.toFixed(2) ?? "—"}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">Aucune note pour ce trimestre.</td></tr>'}</tbody></table></div>
      <p><b>Moyenne générale : ${b.moyenne_generale == null ? "—" : b.moyenne_generale.toFixed(2) + " / 20"}</b>${b.rang ? ` · Rang ${b.rang}/${b.effectif}` : ""} · Absences : ${b.absences.total} (${b.absences.non_justifiees} non justifiée(s))</p><p class="mut"><i>${esc(b.appreciation)}</i></p>
      <h3>Détail des notes</h3><div class="wrap"><table class="tbl"><thead><tr><th>Date</th><th>Matière</th><th>Évaluation</th><th>Note</th><th>/20</th><th>Remarque</th></tr></thead><tbody>${
        notes
          .filter((n) => n.trimestre === t)
          .map(
            (n) =>
              `<tr><td>${fdate(n.date_eval)}</td><td>${esc(n.matiere)}</td><td>${esc(n.titre)}</td><td>${n.valeur}/${n.bareme}</td><td>${n.note20}</td><td>${esc(n.commentaire || "")}</td></tr>`,
          )
          .join("") || '<tr><td colspan="6" class="mut">—</td></tr>'
      }</tbody></table></div>`;
      $$("[data-t]", m).forEach(
        (b) =>
          (b.onclick = () =>
            show(+b.dataset.t).catch((x) => toast(x.message, "bad"))),
      );
      $("#pdfb", m).onclick = () =>
        download(
          `/eleves/${e.id}/bulletin.pdf?trimestre=${t}`,
          `bulletin-T${t}.pdf`,
        );
    };
    await show(1);
  }
  const NP = ["np_nom", "np_prenom", "np_email", "np_telephone"];
  function wireNewParent(m) {
    // affiche/masque le sous-formulaire parent dans la MÊME fenêtre
    const sel = m.querySelector("[name=parent_id]");
    if (!sel) return;
    const sync = () =>
      NP.forEach((k) => {
        const el = m.querySelector(`[name=${k}]`),
          on = sel.value === "__new__";
        el.closest(".f").style.display = on ? "" : "none";
        el.disabled = !on;
      });
    sel.addEventListener("change", sync);
    sync();
  }
  function compteModal(c) {
    const bloc = (t, x) =>
      `<p><b>${t}</b><br>Identifiant : <code>${esc(x.login)}</code><br>Mot de passe temporaire : <code>${esc(x.motdepasse)}</code></p>`;
    const msg =
      c.email_statut === "envoye"
        ? `Un e-mail contenant ces identifiants a été envoyé à <b>${esc(c.email)}</b>.`
        : c.email
          ? `⚠️ L'e-mail à ${esc(c.email)} n'a pas pu être envoyé : transmettez ces identifiants au parent.`
          : "Aucun parent associé à cet élève : transmettez ces identifiants à la famille.";
    modal(
      "Comptes créés",
      `<p>${msg}</p>${c.identifiants.parent ? bloc("Compte parent", c.identifiants.parent) : ""}${c.identifiants.eleve ? bloc("Compte élève", c.identifiants.eleve) : ""}<p class="mut sm">Mots de passe temporaires : à changer à la première connexion.</p>`,
      {},
    );
  }
  P.eleves = resource({
    onForm: (m, row) => wireNewParent(m),
    toPayload: (b) => {
      if (b.parent_id === "__new__") {
        b.nouveau_parent = {
          nom: b.np_nom,
          prenom: b.np_prenom,
          email: b.np_email,
          telephone: b.np_telephone,
        };
        b.parent_id = "";
      }
      NP.forEach((k) => delete b[k]);
      return b;
    },
    after: (res) => {
      if (res?.compte) compteModal(res.compte);
    },
    title: has("parent")
      ? "Mes enfants"
      : has("eleve")
        ? "Mon dossier"
        : "Élèves",
    singular: "élève",
    path: "/eleves",
    write: ["admin"],
    del: ["admin"],
    name: (e) => `${e.prenom} ${e.nom}`,
    noAdd: false,
    fields: eleveFields,
    defaults: () => ({ statut: "inscrit" }),
    cols: [
      col(
        "Élève",
        (e) =>
          `<div class="who-cell">${e.photo_id ? `<img class="av" alt="" data-photo="${e.photo_id}">` : `<span class="av" aria-hidden="true">${initials(e)}</span>`}<div><b>${esc(e.nom)}</b><span class="mut">${esc(e.prenom)}</span></div></div>`,
        true,
      ),
      col("Matricule", (e) => e.matricule),
      col("Classe", (e) => APP.classe(e)),
      col(
        "Naissance",
        (e) =>
          `${fdate(e.date_naissance)} (${Math.floor((Date.now() - new Date(e.date_naissance)) / 31557600000)} ans)`,
      ),
      col("Parent", (e) => e.parent_nom || "—"),
      col(
        "Statut",
        (e) =>
          e.statut === "inscrit"
            ? badge("Inscrit", "ok")
            : badge("Pré-inscrit", "warn"),
        true,
      ),
    ],
    actions: [
      { l: "Bulletin", fn: bulletinModal },
      {
        l: "Valider",
        roles: ["admin"],
        show: (e) => e.statut === "preinscrit",
        fn: async (e, load) => {
          await api("PUT", "/eleves/" + e.id, { statut: "inscrit" });
          toast("Inscription validée", "ok");
          await load();
        },
      },
      {
        l: "Affecter auto",
        roles: ["admin"],
        show: (e) => !e.classe_id,
        fn: async (e, load) => {
          const r = await api("POST", `/eleves/${e.id}/affecter-auto`);
          toast("Affecté en " + r.classe, "ok");
          await load();
        },
      },
      {
        l: "Photo",
        roles: ["admin"],
        fn: (e, load) => {
          const m = modal(
            "Photo — " + e.prenom,
            formHtml([
              {
                k: "fichier",
                l: "Image (PNG/JPG, 5 Mo max)",
                t: "file",
                req: true,
                accept: "image/png,image/jpeg,image/webp",
              },
            ]),
            {
              onSubmit: async (f) => {
                const fd = new FormData();
                fd.append("fichier", f.fichier.files[0]);
                await api("POST", `/eleves/${e.id}/photo`, fd);
                toast("Photo enregistrée", "ok");
                await load();
              },
            },
          );
        },
      },
    ],
    toolbar: (tb, load, main) => {
      if (has("parent")) {
        const b = document.createElement("button");
        b.className = "btn";
        b.innerHTML = ib("user-plus", "Pré-inscrire un enfant");
        tb.appendChild(b);
        b.onclick = () => parentRequestModal();
      }
      if (has("admin")) {
        const ex = document.createElement("button");
        ex.className = "btn sec";
        ex.innerHTML = ib("download-simple", "Export CSV");
        ex.onclick = () => download("/eleves/export", "eleves.csv");
        tb.appendChild(ex);
        const im = document.createElement("button");
        im.className = "btn sec";
        im.innerHTML = ib("upload-simple", "Import CSV");
        tb.appendChild(im);
        im.onclick = () =>
          modal(
            "Importer des élèves (CSV / Excel enregistré en CSV)",
            `<p class="sm">Colonnes : <code>nom;prenom;date_naissance;sexe;classe;parent_email;adresse</code> — dates <code>AAAA-MM-JJ</code> ou <code>JJ/MM/AAAA</code>, sexe M/F, classe ex. <code>1A</code>. Le fichier exporté peut servir de modèle. 500 lignes max.</p>${formHtml([{ k: "csv", l: "Fichier CSV", t: "file", req: true, accept: ".csv,text/csv" }])}`,
            {
              label: "Importer",
              onSubmit: async (f, m) => {
                const rows = parseCsv(await f.csv.files[0].text()).map((r) => {
                  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(
                    r.date_naissance || "",
                  );
                  if (d) r.date_naissance = `${d[3]}-${d[2]}-${d[1]}`;
                  r.sexe = (r.sexe || "").toUpperCase().slice(0, 1);
                  return r;
                });
                const res = await api("POST", "/eleves/import", { rows });
                await load();
                modal(
                  "Résultat de l'import",
                  `<p><b>${res.importes}</b> élève(s) importé(s).</p>${res.erreurs.length ? `<p class="mut">${res.erreurs.length} ligne(s) refusée(s) :</p><ul>${res.erreurs.map((x) => `<li>Ligne ${x.ligne} : ${esc(x.erreur)}</li>`).join("")}</ul>` : ""}`,
                  {},
                );
              },
            },
          );
      }
    },
  });

  // ═════════ Évaluations & saisie des notes ═════════
  async function notesModal(ev) {
    const d = await api("GET", `/evaluations/${ev.id}/notes`);
    modal(
      `Notes — ${ev.titre} (barème /${d.evaluation.bareme})`,
      `<div class="wrap"><table class="tbl"><thead><tr><th>Élève</th><th style="width:130px">Note /${d.evaluation.bareme}</th><th>Remarque</th></tr></thead><tbody>${d.eleves.map((e) => `<tr><td>${esc(e.nom)} ${esc(e.prenom)}</td><td><input type="number" name="n_${e.id}" min="0" max="${d.evaluation.bareme}" step="0.25" value="${e.valeur ?? ""}" aria-label="Note de ${esc(e.prenom)}"></td><td><input name="c_${e.id}" maxlength="255" value="${esc(e.commentaire || "")}"></td></tr>`).join("") || '<tr><td colspan="3" class="empty">Aucun élève dans cette classe.</td></tr>'}</tbody></table></div><p class="mut sm">Laisser une note vide supprime la note existante.</p>`,
      {
        wide: true,
        label: "Enregistrer les notes",
        onSubmit: async (f) => {
          const notes = d.eleves.map((e) => ({
            eleve_id: e.id,
            valeur: f.elements["n_" + e.id].value,
            commentaire: f.elements["c_" + e.id].value,
          }));
          const r = await api("PUT", `/evaluations/${ev.id}/notes`, { notes });
          toast(`${r.modifiees} note(s) mise(s) à jour`, "ok");
        },
      },
    );
  }
  P.evaluations = resource({
    title: "Évaluations & notes",
    singular: "évaluation",
    path: "/evaluations",
    year: true,
    write: ["admin", "enseignant"],
    name: (e) => e.titre,
    cols: [
      col("Date", (e) => fdate(e.date_eval)),
      col("Évaluation", (e) => e.titre),
      col("Matière", (e) => e.matiere),
      col("Classe", (e) => APP.classe(e)),
      col("Trim.", (e) => "T" + e.trimestre),
      col("Barème", (e) => "/" + e.bareme),
      col("Notes saisies", (e) => e.nb_notes),
    ],
    actions: [
      { l: ib("pencil-simple-line", "Saisir les notes", 16), fn: notesModal },
    ],
    defaults: () => ({ bareme: 20, type: "controle", date_eval: today() }),
    fields: async () => [
      {
        k: "classe_id",
        l: "Classe",
        t: "select",
        req: true,
        o: await clsOpts(),
      },
      {
        k: "matiere_id",
        l: "Matière",
        t: "select",
        req: true,
        o: await opts("/matieres", (m) => m.nom),
      },
      { k: "titre", l: "Titre", req: true, minlength: 3, maxlength: 120 },
      {
        k: "type",
        l: "Type",
        t: "select",
        req: true,
        o: [
          { v: "controle", l: "Contrôle continu" },
          { v: "devoir_surveille", l: "Devoir surveillé" },
          { v: "examen", l: "Examen trimestriel" },
        ],
      },
      {
        k: "trimestre",
        l: "Trimestre",
        t: "select",
        req: true,
        o: [1, 2, 3].map((n) => ({ v: n, l: "Trimestre " + n })),
      },
      { k: "date_eval", l: "Date", t: "date", req: true },
      {
        k: "bareme",
        l: "Barème",
        t: "number",
        req: true,
        min: 1,
        max: 100,
        step: 0.5,
      },
    ],
  });

  // Notes & bulletins (parents / élève)
  P.mesnotes = async (main) => {
    const kids = await api("GET", "/eleves");
    main.innerHTML = `<h1>Notes & bulletins</h1>${kids.length ? `<div class="grid g2">${kids.map((k) => `<div class="card"><h3>${esc(k.prenom)} ${esc(k.nom)}</h3><p class="mut">${esc(APP.classe(k))}</p><button class="btn amb" data-k="${k.id}">Voir les notes et bulletins</button></div>`).join("")}</div>` : '<div class="card empty">Aucun élève rattaché à votre compte.</div>'}`;
    main.onclick = (e) => {
      const b = e.target.closest("[data-k]");
      if (b)
        bulletinModal(kids.find((k) => String(k.id) === b.dataset.k)).catch(
          (x) => toast(x.message, "bad"),
        );
    };
  };

  // ═════════ Absences ═════════
  P.absences = resource({
    title: "Absences",
    singular: "absence",
    path: "/absences",
    year: true,
    write: ["admin", "enseignant"],
    del: ["admin", "enseignant"],
    name: (a) => `${a.eleve} le ${fdate(a.date_absence)}`,
    cols: [
      col("Date", (a) => fdate(a.date_absence)),
      col("Élève", (a) => a.eleve),
      col(
        "Période",
        (a) =>
          ({ matin: "Matin", apres_midi: "Après-midi", journee: "Journée" })[
            a.periode
          ],
      ),
      col("Motif", (a) => a.motif || "—"),
      col(
        "Justification",
        (a) =>
          a.justifiee
            ? badge("Justifiée", "ok") +
              ` <span class="mut sm">${esc(a.justification || "")}</span>`
            : badge("Non justifiée", "bad"),
        true,
      ),
    ],
    actions: [
      {
        l: "Justifier",
        roles: ["parent"],
        show: (a) => !a.justifiee,
        fn: (a, load) =>
          modal(
            "Justifier l'absence",
            formHtml([
              {
                k: "justification",
                l: "Motif de la justification",
                t: "textarea",
                req: true,
                minlength: 3,
                maxlength: 500,
              },
            ]),
            {
              onSubmit: async (f) => {
                await api("PUT", `/absences/${a.id}/justifier`, {
                  justification: f.justification.value,
                });
                toast("Justification envoyée", "ok");
                await load();
              },
            },
          ),
      },
    ],
    defaults: () => ({ date_absence: today(), periode: "journee" }),
    fields: async () => [
      {
        k: "eleve_id",
        l: "Élève",
        t: "select",
        req: true,
        o: await opts("/eleves", eleveLabel, (e) => e.statut === "inscrit"),
      },
      { k: "date_absence", l: "Date", t: "date", req: true, max: today() },
      {
        k: "periode",
        l: "Période",
        t: "select",
        req: true,
        o: [
          { v: "journee", l: "Journée" },
          { v: "matin", l: "Matin" },
          { v: "apres_midi", l: "Après-midi" },
        ],
      },
      { k: "motif", l: "Motif", maxlength: 255 },
      { k: "justifiee", l: "Absence justifiée", t: "checkbox" },
      { k: "justification", l: "Justification", maxlength: 500, full: true },
    ],
  });

  // ═════════ Emploi du temps ═════════
  const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
  P.edt = async (main) => {
    const all = await api("GET", "/creneaux");
    let cl = "",
      mine = false;
    const classes = [...new Map(all.map((c) => [c.classe_id, c])).values()];
    const draw = () => {
      const list = all.filter(
        (c) =>
          (!cl || String(c.classe_id) === cl) &&
          (!mine || c.enseignant_id === S.user.id),
      );
      $("#grid", main).innerHTML = `<div class="edt">${DAYS.map(
        (d, i) =>
          `<div class="day"><h2>${d}</h2>${
            list
              .filter((c) => c.jour === i + 1)
              .sort((a, b) => a.debut.localeCompare(b.debut))
              .map(
                (c) =>
                  `<div class="slot sl-${(c.matiere_id % 6) + 1}"><span class="t">${c.debut}–${c.fin}</span><b>${esc(c.matiere)}</b><div>${esc(APP.classe(c))} · ${esc(c.enseignant)}${c.salle ? " · " + esc(c.salle) : ""}</div></div>`,
              )
              .join("") ||
            '<div class="mut sm" style="text-align:center">Aucun cours</div>'
          }</div>`,
      ).join("")}</div>`;
    };
    main.innerHTML = `<div class="page-head"><h1>Emploi du temps</h1><div class="row"><select id="cl" aria-label="Classe" style="width:auto"><option value="">Toutes les classes</option>${classes.map((c) => `<option value="${c.classe_id}">${esc(APP.classe(c))}</option>`).join("")}</select>${has("enseignant") ? '<label class="row" style="margin:0"><input type="checkbox" id="mine"> Mes cours seulement</label>' : ""}</div></div><div class="card" id="grid"></div>`;
    $("#cl", main).onchange = (e) => {
      cl = e.target.value;
      draw();
    };
    if ($("#mine", main))
      $("#mine", main).onchange = (e) => {
        mine = e.target.checked;
        draw();
      };
    draw();
  };
  P.creneaux = resource({
    title: "Créneaux de l'emploi du temps",
    singular: "créneau",
    path: "/creneaux",
    write: ["admin"],
    name: (c) => `${c.matiere} ${DAYS[c.jour - 1]} ${c.debut}`,
    cols: [
      col("Jour", (c) => DAYS[c.jour - 1]),
      col("Horaire", (c) => `${c.debut} – ${c.fin}`),
      col("Classe", (c) => APP.classe(c)),
      col("Matière", (c) => c.matiere),
      col("Enseignant", (c) => c.enseignant),
      col("Salle", (c) => c.salle || "—"),
    ],
    defaults: () => ({ jour: 1, debut: "08:00", fin: "09:00" }),
    fields: async () => [
      {
        k: "classe_id",
        l: "Classe",
        t: "select",
        req: true,
        o: await clsOpts(),
      },
      {
        k: "matiere_id",
        l: "Matière",
        t: "select",
        req: true,
        o: await opts("/matieres", (m) => m.nom),
      },
      {
        k: "enseignant_id",
        l: "Enseignant",
        t: "select",
        req: true,
        o: await opts(
          "/utilisateurs?role=enseignant&actif=true",
          (u) => `${u.nom} ${u.prenom}`,
        ),
      },
      {
        k: "salle_id",
        l: "Salle",
        t: "select",
        empty: "— Aucune —",
        o: await opts(
          "/salles",
          (s) => `${s.nom} (${s.capacite})`,
          (s) => s.disponible,
        ),
      },
      {
        k: "jour",
        l: "Jour",
        t: "select",
        req: true,
        o: DAYS.map((d, i) => ({ v: i + 1, l: d })),
      },
      {
        k: "debut",
        l: "Début",
        t: "time",
        req: true,
        min: "07:30",
        max: "18:00",
      },
      { k: "fin", l: "Fin", t: "time", req: true, min: "07:30", max: "18:00" },
    ],
    note: "Le système refuse les conflits (enseignant, classe ou salle déjà occupés) et vérifie que l'enseignant est affecté à la matière dans la classe.",
  });

  // ═════════ Paiements ═════════
  const payFields = async () => [
    {
      k: "eleve_id",
      l: "Élève",
      t: "select",
      req: true,
      o: await opts(
        "/paiements/soldes",
        (e) =>
          `${e.nom} ${e.prenom} — ${e.matricule}${e.reste > 0 ? " (reste " + money(e.reste) + ")" : " (soldé)"}`,
      ),
    },
    {
      k: "montant",
      l: "Montant (TND)",
      t: "number",
      req: true,
      min: 0.01,
      max: 100000,
      step: 0.01,
      help: "Ne peut pas dépasser le solde restant",
    },
    { k: "date_paiement", l: "Date", t: "date", req: true, max: today() },
    {
      k: "mode",
      l: "Mode de paiement",
      t: "select",
      req: true,
      o: Object.entries(MODES).map(([v, l]) => ({ v, l })),
    },
    { k: "libelle", l: "Objet", req: true, minlength: 3, maxlength: 100 },
    { k: "reference", l: "Référence (virement / mobile)", maxlength: 60 },
  ];
  P.paiements = resource({
    title: "Paiements",
    singular: "paiement",
    path: "/paiements",
    year: true,
    write: ["comptable"],
    name: (p) => `reçu ${p.numero_recu}`,
    cols: [
      col("N° reçu", (p) => p.numero_recu),
      col("Date", (p) => fdate(p.date_paiement)),
      col("Élève", (p) => p.eleve),
      col("Montant", (p) => money(p.montant)),
      col("Mode", (p) => MODES[p.mode]),
      col("Objet", (p) => p.libelle),
      col("Saisi par", (p) => p.saisi_par_nom || "—"),
    ],
    actions: [
      {
        l: ib("receipt", "Reçu PDF", 16),
        fn: (p) =>
          download(`/paiements/${p.id}/recu`, `recu-${p.numero_recu}.pdf`),
      },
    ],
    defaults: () => ({
      date_paiement: today(),
      mode: "especes",
      libelle: "Scolarité",
    }),
    fields: payFields,
    note: "Après enregistrement, un reçu PDF est généré et un message est envoyé automatiquement au parent (montant, date, mode, solde restant, lien du reçu).",
    onLoaded: ({ openForm }) => {
      const m = /eleve=(\d+)/.exec(location.hash);
      if (m && has("comptable")) openForm(null, { eleve_id: m[1] });
    },
  });
  P.recus = resource({
    title: "Reçus de paiement",
    singular: "reçu",
    path: "/recus",
    year: false,
    cols: [
      col("N° reçu", (p) => p.numero_recu),
      col("Date", (p) => fdate(p.date_paiement)),
      col("Élève", (p) => p.eleve),
      col("Objet", (p) => p.libelle),
      col("Année", (p) => p.annee_scolaire),
    ],
    actions: [
      {
        l: ib("download-simple", "Télécharger", 16),
        fn: (p) =>
          download(`/paiements/${p.id}/recu`, `recu-${p.numero_recu}.pdf`),
      },
    ],
  });
  P.finance = async (main) => {
    const ecoles = await api("GET", "/schools");
    let sid = ecoles[0]?.id,
      d,
      tab = "soldes";
    main.innerHTML = `<div class="page-head"><h1>Finances des écoles</h1><select id="se" aria-label="École" style="width:auto">${ecoles.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")}</select></div><div id="fin"></div>`;
    const draw = () => {
      const t = d.totaux,
        stat = (n, l) =>
          `<div class="card stat"><b>${n}</b><span>${l}</span></div>`;
      const body = {
        soldes: `<table class="tbl"><thead><tr><th>Élève</th><th>Classe</th><th>Dû</th><th>Payé</th><th>Reste</th></tr></thead><tbody>${d.soldes.map((r) => `<tr><td>${esc(r.nom)} ${esc(r.prenom)}</td><td>${esc(r.classe || "—")}</td><td>${money(r.du)}</td><td>${money(r.paye)}</td><td>${r.reste > 0 ? badge(money(r.reste), "bad") : badge("Soldé", "ok")}</td></tr>`).join("")}</tbody></table>`,
        paiements: `<table class="tbl"><thead><tr><th>N° reçu</th><th>Date</th><th>Élève</th><th>Montant</th><th>Mode</th><th>Objet</th><th>Saisi par</th><th></th></tr></thead><tbody>${d.paiements.map((p) => `<tr><td>${esc(p.numero_recu)}</td><td>${fdate(p.date_paiement)}</td><td>${esc(p.eleve)}</td><td>${money(p.montant)}</td><td>${MODES[p.mode]}</td><td>${esc(p.libelle)}</td><td>${esc(p.saisi_par || "—")}</td><td class="act"><button class="btn sec sm" data-r="${p.id}" data-n="${esc(p.numero_recu)}">${ib("receipt", "Reçu", 16)}</button></td></tr>`).join("") || '<tr><td colspan="8" class="empty">Aucun paiement.</td></tr>'}</tbody></table>`,
        tarifs: `<table class="tbl"><thead><tr><th>Libellé</th><th>Montant</th></tr></thead><tbody>${d.tarifs.map((x) => `<tr><td>${esc(x.libelle)}</td><td>${money(x.montant)}</td></tr>`).join("") || '<tr><td colspan="2" class="empty">Aucun tarif.</td></tr>'}</tbody></table>`,
      }[tab];
      $("#fin", main).innerHTML =
        `<div class="grid g4" style="margin-bottom:16px">${stat(money(t.encaisse), "Encaissé (" + esc(d.annee) + ")")}${stat(money(t.du), "Total dû")}${stat(money(t.reste), "Reste à encaisser")}${stat(d.soldes.filter((r) => r.reste > 0).length, "Élèves avec un reste à payer")}</div>
      <div class="card"><div class="tabs">${[
        ["soldes", "Soldes par élève"],
        ["paiements", "Paiements & reçus"],
        ["tarifs", "Grille tarifaire"],
      ]
        .map(
          (x) =>
            `<button type="button" data-tab="${x[0]}" class="${tab === x[0] ? "on" : ""}">${x[1]}</button>`,
        )
        .join(
          "",
        )}</div><div class="wrap">${body}</div><p class="mut sm">Lecture seule — données financières de l'école sélectionnée.</p></div>`;
    };
    const load = async () => {
      d = await api("GET", `/schools/${sid}/finance`);
      draw();
    };
    $("#se", main).onchange = (e) => {
      sid = e.target.value;
      load().catch((x) => toast(x.message, "bad"));
    };
    main.onclick = (e) => {
      const t = e.target.closest("[data-tab]"),
        r = e.target.closest("[data-r]");
      if (t) {
        tab = t.dataset.tab;
        draw();
      }
      if (r)
        download(
          `/schools/${sid}/paiements/${r.dataset.r}/recu`,
          `recu-${r.dataset.n}.pdf`,
        );
    };
    if (sid) await load();
    else
      $("#fin", main).innerHTML = '<div class="card empty">Aucune école.</div>';
  };
  P.impayes = async (main) => {
    const rows = await api("GET", "/paiements/soldes"),
      compta = has("comptable");
    let only = true;
    const ST = {
      solde: ["Soldé", "ok"],
      partiel: ["Paiement partiel", "warn"],
      impaye: ["Rien payé", "bad"],
    };
    const draw = () => {
      const l = rows.filter(
        (r) => !only || (compta ? r.reste > 0 : r.statut !== "solde"),
      );
      $("#t", main).innerHTML = compta
        ? `<p><b>${l.length}</b> élève(s) — total restant à encaisser : <b>${money(l.reduce((s, r) => s + Math.max(0, r.reste), 0))}</b></p><div class="wrap"><table class="tbl"><thead><tr><th>Élève</th><th>Classe</th><th>Dû</th><th>Payé</th><th>Reste</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${l.map((r) => `<tr><td>${esc(r.nom)} ${esc(r.prenom)}</td><td>${esc(r.classe || "—")}</td><td>${money(r.du)}</td><td>${money(r.paye)}</td><td>${r.reste > 0 ? badge(money(r.reste), "bad") : badge("Soldé", "ok")}</td><td class="act">${r.reste > 0 ? `<a class="btn sec sm" href="#/paiements?eleve=${r.id}">Encaisser</a>` : ""}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">Aucun impayé</td></tr>'}</tbody></table></div>`
        : `<p><b>${l.length}</b> élève(s) concerné(s)</p><div class="wrap"><table class="tbl"><thead><tr><th>Élève</th><th>Matricule</th><th>Classe</th><th>Situation</th></tr></thead><tbody>${l.map((r) => `<tr><td>${esc(r.nom)} ${esc(r.prenom)}</td><td>${esc(r.matricule)}</td><td>${esc(r.classe || "—")}</td><td>${badge(ST[r.statut][0], ST[r.statut][1])}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">Tous les élèves sont à jour</td></tr>'}</tbody></table></div>`;
    };
    main.innerHTML = `<div class="page-head"><h1>${compta ? "Suivi des impayés" : "Qui a payé ?"} — ${esc(APP.year())}</h1>${compta ? `<button class="btn" id="rel">${ib("paper-plane-tilt", "Envoyer les relances")}</button>` : ""}</div>${compta ? "" : '<p class="mut">Vue de la direction : situation de paiement de chaque élève, sans les montants. Le détail est réservé à la comptabilité.</p>'}<div class="card"><label class="row" style="margin-bottom:8px"><input type="checkbox" id="only" checked> ${compta ? "Impayés seulement" : "Afficher seulement ceux qui n'ont pas tout payé"}</label><div id="t"></div></div>`;
    $("#only", main).onchange = (e) => {
      only = e.target.checked;
      draw();
    };
    if (compta)
      $("#rel", main).onclick = async () => {
        if (
          await APP.confirm(
            "Envoyer un message de rappel aux parents de tous les élèves ayant un solde restant ?",
          )
        ) {
          const r = await api("POST", "/paiements/relances");
          toast(`${r.envoyees} relance(s) envoyée(s)`, "ok");
        }
      };
    draw();
  };

  // ═════════ Devoirs ═════════
  const STAT = {
    a_rendre: ["À rendre", ""],
    non_rendu: ["Non rendu", "bad"],
    rendu: ["Rendu", "ok"],
    en_retard: ["En retard", "warn"],
    rendu_note: ["Noté", "ok"],
    en_retard_note: ["Noté (en retard)", "warn"],
  };
  const fileBtns = (fs = []) =>
    fs
      .map(
        (f) =>
          `<button type="button" class="btn sec sm" data-f="${f.id}" data-n="${esc(f.nom)}">${ic("paperclip", 16)} ${esc(f.nom)}</button>`,
      )
      .join(" ");
  async function depotsModal(d) {
    const r = await api("GET", `/devoirs/${d.id}/depots`),
      teach = has("admin", "enseignant"),
      kid = has("parent");
    const m = modal(
      `${d.titre} — ${teach ? "dépôts et notes" : "suivi"}`,
      `<p class="mut">Remise : ${fdate(d.date_remise)} · barème /${d.bareme}</p><div class="wrap"><table class="tbl"><thead><tr><th>Élève</th><th>Statut</th><th>Fichiers</th><th>Note</th><th></th></tr></thead><tbody>${
        r.depots
          .map((x) => {
            const st = STAT[x.statut] || ["—", ""];
            const note = teach
              ? x.depot_id
                ? `<input type="number" min="0" max="${d.bareme}" step="0.25" value="${x.note ?? ""}" data-note="${x.depot_id}" style="width:90px" aria-label="Note"><input data-com="${x.depot_id}" value="${esc(x.commentaire || "")}" maxlength="500" placeholder="Commentaire" style="margin-top:4px">`
                : "—"
              : x.note != null
                ? `<b>${x.note}/${d.bareme}</b><div class="sm mut">${esc(x.commentaire || "")}</div>`
                : "—";
            return `<tr><td>${esc(x.nom)} ${esc(x.prenom)}</td><td>${badge(st[0], st[1])}<div class="sm mut">${x.date_depot ? fdt(x.date_depot) : ""}</div></td><td>${fileBtns(x.fichiers) || "—"}</td><td>${note}</td><td class="act">${teach && x.depot_id ? `<button type="button" class="btn amb sm" data-save="${x.depot_id}">Noter</button>` : ""}${kid && x.depot_id && !x.vu_parent ? `<button type="button" class="btn sec sm" data-vu="${x.depot_id}">Marquer « vu »</button>` : kid && x.depot_id ? badge("Vu", "ok") : ""}</td></tr>`;
          })
          .join("") ||
        '<tr><td colspan="5" class="empty">Aucun élève.</td></tr>'
      }</tbody></table></div>`,
      { wide: true },
    );
    m.addEventListener("click", async (e) => {
      try {
        const s = e.target.closest("[data-save]"),
          v = e.target.closest("[data-vu]");
        if (s) {
          const id = s.dataset.save;
          await api("PUT", `/depots/${id}/noter`, {
            note: $(`[data-note="${id}"]`, m).value,
            commentaire: $(`[data-com="${id}"]`, m).value,
          });
          toast("Note enregistrée", "ok");
        }
        if (v) {
          await api("POST", `/depots/${v.dataset.vu}/vu`);
          v.replaceWith(
            Object.assign(document.createElement("span"), {
              innerHTML: badge("Vu", "ok"),
            }),
          );
        }
      } catch (x) {
        toast(x.message, "bad");
      }
    });
  }
  async function monDepot(d, load) {
    const r = await api("GET", `/devoirs/${d.id}/depots`),
      x = r.depots[0],
      st = x ? STAT[x.statut] : ["—", ""],
      locked = x && x.note != null,
      late = d.date_remise < today();
    modal(
      `Mon travail — ${d.titre}`,
      `<p>Statut : ${badge(st[0], st[1])} ${x?.date_depot ? `<span class="mut">déposé le ${fdt(x.date_depot)}</span>` : ""}</p>${x?.fichiers?.length ? `<p>Fichiers déposés : ${fileBtns(x.fichiers)}</p>` : ""}
    ${x?.note != null ? `<div class="card"><b>Note : ${x.note}/${d.bareme}</b><br>${esc(x.commentaire || "")}</div>` : ""}
    ${locked ? '<p class="mut">Travail noté : le remplacement n\'est plus possible.</p>' : x?.depot_id && late ? '<p class="mut">La date de remise est dépassée : le dépôt ne peut plus être remplacé.</p>' : formHtml([{ k: "fichiers", l: x?.depot_id ? "Remplacer mon dépôt (1 à 3 fichiers)" : "Déposer mon travail (1 à 3 fichiers : PDF, images, Word…)", t: "file", req: true, multiple: true, accept: ".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt,.xls,.xlsx", help: "5 Mo maximum par fichier" + (late ? " — attention : dépôt en retard" : "") }])}`,
      {
        label: "Envoyer",
        onSubmit:
          locked || (x?.depot_id && late)
            ? undefined
            : async (f) => {
                const fd = new FormData();
                [...f.fichiers.files]
                  .slice(0, 3)
                  .forEach((file) => fd.append("fichiers", file));
                const res = await api("POST", `/devoirs/${d.id}/depot`, fd);
                toast(
                  res.en_retard
                    ? "Travail déposé (en retard)"
                    : "Travail déposé",
                  "ok",
                );
                await load();
              },
      },
    ).addEventListener("click", (e) => {
      const b = e.target.closest("[data-f]");
      if (b) download("/fichiers/" + b.dataset.f, b.dataset.n);
    });
  }
  P.devoirs = resource({
    title: "Devoirs",
    singular: "devoir",
    path: "/devoirs",
    write: ["admin", "enseignant"],
    forceDelete: true,
    name: (d) => d.titre,
    cols: [
      col(
        "Titre",
        (d) =>
          `<b>${esc(d.titre)}</b><div class="sm mut">${esc(d.description || "").slice(0, 90)}</div>`,
        true,
      ),
      col("Matière", (d) => d.matiere),
      col("Classe", (d) => APP.classe(d)),
      col("Enseignant", (d) => d.enseignant),
      col(
        "Remise",
        (d) =>
          `${fdate(d.date_remise)} ${d.date_remise < today() ? badge("Échue", "warn") : ""}`,
        true,
      ),
      col(
        "Documents",
        (d) =>
          `${fileBtns(d.pieces)} ${d.a_correction && (d.correction_dispo || has("admin", "enseignant")) ? `<button type="button" class="btn sm" data-f="${d.correction_id}" data-n="correction">${ib("seal-check", "Correction", 16)}</button>` : ""}` ||
          "—",
        true,
      ),
      ...(has("admin", "enseignant")
        ? [col("Dépôts", (d) => d.nb_depots)]
        : []),
    ],
    actions: [
      {
        l: ib("tray", "Dépôts & notes", 16),
        roles: ["admin", "enseignant"],
        fn: (d) => depotsModal(d),
      },
      {
        l: ib("seal-check", "Correction", 16),
        roles: ["admin", "enseignant"],
        fn: (d, load) =>
          modal(
            "Correction — " + d.titre,
            formHtml([
              { k: "fichier", l: "Fichier corrigé", t: "file", req: true },
            ]) +
              '<p class="mut sm">Visible par les élèves et les parents après la date de remise.</p>',
            {
              onSubmit: async (f) => {
                const fd = new FormData();
                fd.append("fichier", f.fichier.files[0]);
                await api("POST", `/devoirs/${d.id}/correction`, fd);
                toast("Correction publiée", "ok");
                await load();
              },
            },
          ),
      },
      {
        l: ib("upload-simple", "Mon dépôt", 16),
        roles: ["eleve"],
        fn: monDepot,
      },
      {
        l: ib("eye", "Suivi", 16),
        roles: ["parent"],
        fn: (d) => depotsModal(d),
      },
    ],
    defaults: () => ({ bareme: 20, date_remise: today() }),
    fields: async (row) => [
      {
        k: "classe_id",
        l: "Classe",
        t: "select",
        req: true,
        o: await clsOpts(),
      },
      {
        k: "matiere_id",
        l: "Matière",
        t: "select",
        req: true,
        o: await opts("/matieres", (m) => m.nom),
      },
      {
        k: "titre",
        l: "Titre",
        req: true,
        minlength: 3,
        maxlength: 150,
        full: true,
      },
      {
        k: "description",
        l: "Consignes",
        t: "textarea",
        rows: 4,
        maxlength: 5000,
        full: true,
      },
      {
        k: "date_remise",
        l: "Date de remise",
        t: "date",
        req: true,
        min: row ? undefined : today(),
      },
      {
        k: "bareme",
        l: "Barème",
        t: "number",
        req: true,
        min: 1,
        max: 100,
        step: 0.5,
      },
      {
        k: "pieces",
        l: "Pièces jointes (PDF, images, documents)",
        t: "file",
        multiple: true,
        full: true,
        help: "8 pièces maximum, 5 Mo chacune",
      },
    ],
    after: async (res, f) => {
      if (f.pieces?.files.length) {
        const fd = new FormData();
        [...f.pieces.files].forEach((x) => fd.append("fichiers", x));
        await api("POST", `/devoirs/${res.id}/pieces`, fd);
      }
    },
    onLoaded: ({}) => {
      $("#main").addEventListener("click", (e) => {
        const b = e.target.closest("[data-f]");
        if (b && !b.closest(".overlay"))
          download("/fichiers/" + b.dataset.f, b.dataset.n);
      });
    },
  });

  // ═════════ Messagerie ═════════
  const renderCorps = (t) =>
    esc(t).replace(
      /\/api\/paiements\/(\d+)\/recu/g,
      `<button type="button" class="btn sm" data-rc="$1">${ib("receipt", "Télécharger le reçu", 16)}</button>`,
    );
  async function compose(pre = {}) {
    const recs = await api("GET", "/messages/destinataires"),
      sel = new Set((pre.to || []).map(String));
    const fields = [
      {
        k: "objet",
        l: "Objet",
        req: true,
        minlength: 3,
        maxlength: 150,
        full: true,
      },
      {
        k: "corps",
        l: "Message",
        t: "textarea",
        rows: 6,
        req: true,
        maxlength: 5000,
        full: true,
      },
      {
        k: "pj",
        l: "Pièces jointes (5 max.)",
        t: "file",
        multiple: true,
        full: true,
      },
    ];
    const html = `<div class="f"><label>Destinataires <span class="mut">*</span></label>${has("admin") ? '<div class="row sm" style="margin-bottom:6px">Sélection rapide : ' + ["parent", "enseignant", "eleve"].map((r) => `<button type="button" class="btn sec sm" data-grp="${r}">Tous : ${APP.ROLES[r].toLowerCase()}s</button>`).join("") + '<button type="button" class="btn sec sm" data-grp="">Aucun</button></div>' : ""}
    <input id="rs" placeholder="Filtrer la liste…" style="margin-bottom:6px"><div class="reclist">${recs.map((r) => `<label data-t="${esc((r.nom + " " + r.prenom + " " + (r.eleve || "")).toLowerCase())}"><input type="checkbox" name="dest" value="${r.id}" data-role="${r.role}" data-eleve="${r.eleve_id || ""}"${sel.has(String(r.id)) ? " checked" : ""}> ${esc(r.nom)} ${esc(r.prenom)} <span class="mut">— ${APP.ROLES[r.role]}${r.eleve ? " · " + (r.role === "parent" ? "parent de " : "enseignant de ") + esc(r.eleve) : ""}</span></label>`).join("") || '<div class="empty">Aucun destinataire autorisé.</div>'}</div><small>Vous ne pouvez écrire qu'aux personnes autorisées pour votre rôle.</small></div>${formHtml(fields, pre)}`;
    const m = modal(
      pre.id ? "Modifier le brouillon" : "Nouveau message",
      html,
      {
        wide: true,
        label: "Envoyer",
        extra: [{ id: "draft", label: "Enregistrer en brouillon" }],
        onSubmit: async (f, mm) => {
          const draft = f.dataset.mode === "draft",
            chk = $$("[name=dest]:checked", f);
          if (!draft && !chk.length)
            throw new Error("Choisissez au moins un destinataire");
          const pieces = [];
          for (const file of [...f.pj.files].slice(0, 5)) {
            const fd = new FormData();
            fd.append("fichier", file);
            pieces.push((await api("POST", "/fichiers", fd)).id);
          }
          const body = {
            objet: f.objet.value,
            corps: f.corps.value,
            destinataires: chk.map((c) => +c.value),
            eleve_id:
              chk.map((c) => c.dataset.eleve).find(Boolean) ||
              pre.eleve_id ||
              undefined,
            pieces,
            brouillon: draft,
          };
          if (pre.id) await api("PUT", `/messages/${pre.id}`, body);
          else await api("POST", "/messages", body);
          toast(draft ? "Brouillon enregistré" : "Message envoyé", "ok");
          APP.route();
        },
      },
    );
    $("#rs", m).oninput = (e) =>
      $$(".reclist label", m).forEach(
        (l) => (l.hidden = !l.dataset.t.includes(e.target.value.toLowerCase())),
      );
    m.addEventListener("click", (e) => {
      const g = e.target.closest("[data-grp]");
      if (g)
        $$("[name=dest]", m).forEach(
          (c) =>
            (c.checked =
              g.dataset.grp !== "" && c.dataset.role === g.dataset.grp),
        );
    });
  }
  async function openMessage(id, tab) {
    const x = await api("GET", "/messages/" + id),
      isMine = x.expediteur_id === S.user.id;
    const m = modal(
      x.objet,
      `<p class="mut sm">${x.type === "annonce" ? badge("Annonce", "info") + " " : ""}De : <b>${esc(x.expediteur.prenom)} ${esc(x.expediteur.nom)}</b> (${APP.ROLES[x.expediteur.role]}) · ${fdt(x.sent_at || x.created_at)}${x.destinataires ? "<br>À : " + x.destinataires.map((d) => esc(d.nom) + (d.lu ? " (lu)" : "")).join(", ") : ""}${x.eleve ? `<br>Concernant : ${esc(x.eleve.prenom)} ${esc(x.eleve.nom)}` : ""}</p>
    <div class="msgbody">${renderCorps(x.corps)}</div>${x.pieces?.length ? `<p>${fileBtns(x.pieces)}</p>` : ""}<p class="mut sm row" style="gap:6px">${ic("lock-simple", 16)} ${x.immuable ? "Message envoyé : il ne peut être ni modifié ni supprimé (traçabilité)." : "Brouillon : modifiable librement avant envoi."}</p>
    <div class="row">${!isMine && x.type === "message" ? `<button type="button" class="btn sm" id="rep">${ib("chat-circle-text", "Répondre", 16)}</button>` : ""}${tab === "recus" ? `<button type="button" class="btn bad sm" id="hid">${ib("eye-slash", "Masquer de ma boîte", 16)}</button>` : ""}${x.statut === "brouillon" ? `<button type="button" class="btn sm" id="ed">${ib("pencil-simple", "Modifier / envoyer", 16)}</button><button type="button" class="btn bad sm" id="rm">${ib("trash", "Supprimer le brouillon", 16)}</button>` : ""}</div>`,
      { wide: true },
    );
    m.addEventListener("click", async (e) => {
      try {
        const f = e.target.closest("[data-f]"),
          rc = e.target.closest("[data-rc]");
        if (f) download("/fichiers/" + f.dataset.f, f.dataset.n);
        if (rc) download(`/paiements/${rc.dataset.rc}/recu`, "recu.pdf");
        if (e.target.id === "rep") {
          m.close();
          compose({
            to: [x.expediteur_id],
            objet: "Re : " + x.objet.replace(/^Re : /, ""),
            eleve_id: x.eleve_id,
          });
        }
        if (e.target.id === "hid") {
          await api("POST", `/messages/${id}/masquer`);
          m.close();
          APP.route();
        }
        if (
          e.target.id === "rm" &&
          (await APP.confirm("Supprimer ce brouillon ?"))
        ) {
          await api("DELETE", "/messages/" + id);
          m.close();
          APP.route();
        }
        if (e.target.id === "ed") {
          m.close();
          compose({
            id,
            objet: x.objet,
            corps: x.corps,
            to: (x.destinataires || []).map((d) => d.destinataire_id),
            eleve_id: x.eleve_id,
          });
        }
      } catch (err) {
        toast(err.message, "bad");
      }
    });
  }
  P.messages = async (main) => {
    let tab = "recus";
    const TABS = [
      ["recus", "Reçus", "tray"],
      ["envoyes", "Envoyés", "paper-plane-tilt"],
      ["brouillons", "Brouillons", "pencil-simple-line"],
      ["annonces", "Annonces", "megaphone"],
    ];
    main.innerHTML = `<div class="page-head"><h1>Messagerie</h1><div class="row"><button class="btn" id="nw">${ib("envelope-simple", "Nouveau message")}</button>${has("admin") ? `<button class="btn sec" id="an">${ib("megaphone", "Nouvelle annonce")}</button>` : ""}</div></div><div class="card flush"><div class="tabs" id="tabs" style="padding:0 var(--s4);margin:0">${TABS.map((t) => `<button type="button" data-tab="${t[0]}">${ic(t[2], 18)} ${t[1]}</button>`).join("")}</div><div id="list"></div></div>`;
    const load = async () => {
      $$("#tabs button", main).forEach((b) => {
        const on = b.dataset.tab === tab;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on);
      });
      const rows = await api("GET", "/messages?dossier=" + tab);
      $("#list", main).innerHTML = rows.length
        ? rows
            .map(
              (r) =>
                `<div class="msg ${tab === "recus" && !r.lu ? "unread" : ""}" data-id="${r.id}" tabindex="0" role="button" aria-label="${tab === "recus" && !r.lu ? "Non lu : " : ""}${esc(r.objet)}"><span class="dot" aria-hidden="true"></span><span class="subj">${esc(r.objet)}</span><span class="date">${fdt(r.sent_at || r.created_at)}</span><span class="meta">${tab === "envoyes" ? "À : " + esc(r.destinataires || "—") : tab === "brouillons" ? "Brouillon" : esc(r.expediteur)}${r.eleve ? " · " + esc(r.eleve) : ""} — ${esc(r.extrait)}</span></div>`,
            )
            .join("")
        : APP.empty(
            tab === "recus"
              ? "Votre boîte de réception est vide"
              : "Aucun message ici",
            tab === "recus" ? "Les nouveaux messages apparaîtront ici." : "",
            "envelope-simple",
          );
    };
    main.onclick = async (e) => {
      try {
        const t = e.target.closest("[data-tab]"),
          m = e.target.closest(".msg");
        if (t) {
          tab = t.dataset.tab;
          await load();
        } else if (m) {
          await openMessage(m.dataset.id, tab);
          await load();
        }
      } catch (x) {
        toast(x.message, "bad");
      }
    };
    main.onkeydown = (e) => {
      if (e.key === "Enter" && e.target.classList?.contains("msg"))
        e.target.click();
    };
    $("#nw", main).onclick = () =>
      compose().catch((x) => toast(x.message, "bad"));
    if ($("#an", main))
      $("#an", main).onclick = () => {
        const fl = [
          {
            k: "objet",
            l: "Objet",
            req: true,
            minlength: 3,
            maxlength: 150,
            full: true,
          },
          {
            k: "cible",
            l: "Destinataires",
            t: "select",
            req: true,
            o: [
              { v: "tous", l: "Tout le monde" },
              { v: "parents", l: "Parents" },
              { v: "enseignants", l: "Enseignants" },
              { v: "eleves", l: "Élèves" },
            ],
          },
          {
            k: "corps",
            l: "Annonce",
            t: "textarea",
            rows: 6,
            req: true,
            maxlength: 5000,
            full: true,
          },
        ];
        modal(
          "Nouvelle annonce",
          formHtml(fl) +
            `<div class="alert">${ic("warning", 20)}<span>Une annonce publiée ne peut être ni modifiée ni supprimée. En cas d'erreur, publiez une annonce corrective.</span></div>`,
          {
            label: "Publier",
            onSubmit: async (f) => {
              await api("POST", "/annonces", readForm(f, fl));
              toast("Annonce publiée", "ok");
              tab = "annonces";
              await load();
            },
          },
        );
      };
    await load();
  };

  // ═════════ Journal, écoles, paramètres, profil ═════════
  const diff = (r) => {
    if (!r.nouvelles && !r.anciennes) return "";
    const n = r.nouvelles || {},
      o = r.anciennes || {};
    return Object.keys({ ...o, ...n })
      .slice(0, 6)
      .map(
        (k) =>
          `${k} : ${o[k] != null ? JSON.stringify(o[k]) + " → " : ""}${JSON.stringify(n[k] ?? null)}`,
      )
      .join(" · ");
  };
  P.journal = async (main) => {
    const ENT = has("comptable")
      ? ["", "paiements", "tarifs"]
      : [
          "",
          "eleves",
          "classes",
          "matieres",
          "salles",
          "utilisateurs",
          "notes",
          "absences",
          "devoirs",
          "depots",
          "messages",
          "annonces",
          "creneaux",
          "evaluations",
          "affectations",
          "ecole",
        ];
    main.innerHTML = `<div class="page-head"><h1>Journal d'actions</h1><select id="e" aria-label="Entité" style="width:auto">${ENT.map((e) => `<option value="${e}">${e || "Toutes les entités"}</option>`).join("")}</select></div><div class="card flush wrap" id="t"></div>`;
    const load = async () => {
      const r = await api(
        "GET",
        "/journal" +
          ($("#e", main).value ? "?entite=" + $("#e", main).value : ""),
      );
      $("#t", main).innerHTML =
        `<table class="tbl"><thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Entité</th><th>Détail (anciennes → nouvelles valeurs)</th></tr></thead><tbody>${r.map((x) => `<tr><td>${fdt(x.created_at)}</td><td>${esc(x.utilisateur || "—")}</td><td>${badge(x.action, x.action === "SUPPR" ? "bad" : x.action === "AJOUT" ? "ok" : "")}</td><td>${esc(x.entite)} #${x.entite_id ?? ""}</td><td class="sm">${esc(diff(x))}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">Aucune entrée.</td></tr>'}</tbody></table>`;
    };
    $("#e", main).onchange = load;
    await load();
  };
  P.ecoles = resource({
    title: "Écoles clientes",
    singular: "école",
    path: "/schools",
    write: ["superadmin"],
    del: [],
    name: (s) => s.name,
    defaults: () => ({ status: "trial", plan: "basic" }),
    cols: [
      col("École", (s) => s.name),
      col(
        "Statut",
        (s) =>
          badge(
            { trial: "Essai", active: "Actif", suspended: "Suspendu" }[
              s.status
            ],
            { trial: "warn", active: "ok", suspended: "bad" }[s.status],
          ),
        true,
      ),
      col("Formule", (s) => s.plan),
      col("Fin d'abonnement", (s) =>
        s.subscription_end ? fdate(s.subscription_end) : "—",
      ),
      col("Utilisateurs", (s) => s.utilisateurs),
      col("Élèves", (s) => s.eleves),
      col("Encaissé", (s) => money(s.encaisse)),
    ],
    fields: async (row) => [
      {
        k: "name",
        l: "Nom de l'école",
        req: true,
        minlength: 3,
        maxlength: 200,
        full: true,
      },
      {
        k: "status",
        l: "Statut",
        t: "select",
        req: true,
        o: [
          { v: "trial", l: "Essai" },
          { v: "active", l: "Actif" },
          { v: "suspended", l: "Suspendu" },
        ],
      },
      {
        k: "plan",
        l: "Formule",
        t: "select",
        req: true,
        o: ["basic", "standard", "premium"].map((v) => ({ v, l: v })),
      },
      { k: "subscription_end", l: "Fin d'abonnement", t: "date" },
      { k: "telephone", l: "Téléphone", t: "tel" },
      { k: "email", l: "E-mail", t: "email" },
      { k: "adresse", l: "Adresse", full: true },
      ...(row
        ? []
        : [
            {
              k: "nb_salles",
              l: "Nombre de salles de l'école",
              t: "number",
              req: true,
              min: 1,
              max: 60,
              step: 1,
              help: "Les salles « Salle 1 … Salle N » seront créées automatiquement",
            },
            { k: "admin_prenom", l: "Directeur : prénom", req: true },
            { k: "admin_nom", l: "Directeur : nom", req: true },
            {
              k: "admin_email",
              l: "Directeur : e-mail",
              t: "email",
              req: true,
            },
            {
              k: "admin_password",
              l: "Directeur : mot de passe temporaire",
              t: "password",
              req: true,
              minlength: 8,
              pattern: "(?=.*[A-Za-z])(?=.*[0-9]).{8,72}",
              help: "Envoyé par e-mail au directeur, qui devra le changer à sa première connexion",
            },
          ]),
    ],
    toPayload: (b, isNew) => {
      if (!isNew) return b;
      const { admin_prenom, admin_nom, admin_email, admin_password, ...s } = b;
      return {
        ...s,
        admin: {
          prenom: admin_prenom,
          nom: admin_nom,
          email: admin_email,
          password: admin_password,
        },
      };
    },
    after: (res, f, isNew) => {
      if (isNew && res.admin)
        toast(
          res.admin.email_statut === "envoye"
            ? `École créée : e-mail envoyé à ${res.admin.email}`
            : "École créée, mais l'e-mail n'a pas pu être envoyé (SMTP) : communiquez les identifiants au directeur",
          res.admin.email_statut === "envoye" ? "ok" : "bad",
        );
    },
    actions: [
      {
        l: "+ Administrateur",
        fn: (s) => {
          const fl = [
            { k: "prenom", l: "Prénom", req: true },
            { k: "nom", l: "Nom", req: true },
            { k: "email", l: "E-mail", t: "email", req: true },
            {
              k: "password",
              l: "Mot de passe",
              t: "password",
              req: true,
              minlength: 8,
            },
          ];
          modal("Nouvel administrateur — " + s.name, formHtml(fl), {
            onSubmit: async (f) => {
              await api("POST", `/schools/${s.id}/admins`, readForm(f, fl));
              toast("Administrateur créé", "ok");
            },
          });
        },
      },
    ],
  });
  P.ecole = async (main) => {
    const e = await api("GET", "/ecole"),
      next = `${APP.startYear() + 1}-${APP.startYear() + 2}`;
    const fl = [
      {
        k: "name",
        l: "Nom de l'école",
        req: true,
        minlength: 3,
        maxlength: 200,
        full: true,
      },
      { k: "adresse", l: "Adresse", full: true },
      { k: "telephone", l: "Téléphone", t: "tel" },
      { k: "email", l: "E-mail", t: "email" },
    ];
    main.innerHTML = `<h1>Paramètres de l'école</h1><div class="grid g2"><form class="card" id="sf" novalidate><h2>Informations</h2>${formHtml(fl, e)}<button class="btn amb">Enregistrer</button></form>
    <div class="card"><h2>Année scolaire</h2><p>Année en cours : <b>${esc(e.annee_courante)}</b></p><p>Abonnement : ${badge({ trial: "Essai", active: "Actif", suspended: "Suspendu" }[e.status])} formule <b>${esc(e.plan)}</b>${e.subscription_end ? " jusqu'au " + fdate(e.subscription_end) : ""}</p>
    <p class="mut sm">Ouvrir l'année suivante copie les classes (niveau, section, capacité) et promeut automatiquement les élèves au niveau supérieur. Les notes, paiements et absences des années passées sont conservés.</p><button class="btn bad" id="ny">Ouvrir l'année ${next}</button></div></div>`;
    $("#sf", main).onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await api("PUT", "/ecole", readForm(ev.target, fl));
        toast("Informations enregistrées", "ok");
      } catch (x) {
        toast(x.message, "bad");
      }
    };
    $("#ny", main).onclick = async () => {
      if (
        !(await APP.confirm(
          `Ouvrir l'année ${next} ? Cette action fait passer l'école à la nouvelle année et promeut les élèves.`,
          "Ouvrir",
        ))
      )
        return;
      try {
        const r = await api("POST", "/ecole/annee", { annee: next });
        S.user.school.annee_courante = r.annee;
        localStorage.setItem("user", JSON.stringify(S.user));
        toast(`Année ${r.annee} ouverte, ${r.promus} élève(s) promu(s)`, "ok");
        setTimeout(() => location.reload(), 900);
      } catch (x) {
        toast(x.message, "bad");
      }
    };
  };
  P.profil = async (main) => {
    const fl = [
      { k: "ancien", l: "Mot de passe actuel", t: "password", req: true },
      {
        k: "nouveau",
        l: "Nouveau mot de passe",
        t: "password",
        req: true,
        minlength: 8,
        maxlength: 72,
        pattern: "(?=.*[A-Za-z])(?=.*[0-9]).{8,72}",
        help: "8 caractères minimum, lettre + chiffre",
      },
      {
        k: "confirm",
        l: "Confirmer le nouveau mot de passe",
        t: "password",
        req: true,
      },
    ];
    main.innerHTML = `<h1 style="margin-bottom:var(--s5)">Mon profil</h1>${S.user.mdp_temporaire ? alertBox("warning", "<b>Vous utilisez un mot de passe temporaire.</b> Choisissez dès maintenant votre mot de passe personnel ci-dessous.").replace('class="alert', 'id="tmpw" class="alert') : ""}<div class="grid g2"><div class="card"><h2>${esc(S.user.prenom)} ${esc(S.user.nom)}</h2><p>${esc(S.user.email)}<br>${APP.ROLES[S.user.role]}${S.user.school ? " — " + esc(S.user.school.name) : ""}</p>
    ${"Notification" in window ? `<button class="btn sec" id="pn">${ib("bell", "Activer les notifications du navigateur")}</button>` : ""}</div>
    <form class="card" id="pf" novalidate><h2>Changer le mot de passe</h2>${formHtml(fl)}<button class="btn amb">Modifier</button></form></div>`;
    if ($("#pn", main))
      $("#pn", main).onclick = async () =>
        toast(
          (await Notification.requestPermission()) === "granted"
            ? "Notifications activées"
            : "Notifications refusées",
          "ok",
        );
    $("#pf", main).onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      if (f.nouveau.value !== f.confirm.value)
        return toast("La confirmation ne correspond pas", "bad");
      try {
        await api("POST", "/auth/mot-de-passe", {
          ancien: f.ancien.value,
          nouveau: f.nouveau.value,
        });
        S.user.mdp_temporaire = false;
        localStorage.setItem("user", JSON.stringify(S.user));
        $("#tmpw")?.remove();
        toast("Mot de passe modifié", "ok");
        f.reset();
      } catch (x) {
        toast(x.message, "bad");
      }
    };
  };

  // ═════════ Accueil ═════════
  const stat = (n, l, icon, tone = "", href = "") =>
    `<${href ? "a" : "div"} class="card stat${href ? " link" : ""}"${href ? ` href="${href}"` : ""}><div class="stat-ic ${tone}">${ic(icon, 24)}</div><div><span>${l}</span><b>${n}</b></div></${href ? "a" : "div"}>`;
  const alertBox = (icon, html, tone = "") =>
    `<div class="alert ${tone}">${ic(icon, 20)}<span>${html}</span></div>`;
  P.accueil = async (main) => {
    const st = (S.stats = await api("GET", "/stats")),
      r = S.user.role;
    const day = new Date().toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    let body = "",
      ann = "";
    if (r === "superadmin")
      body = `<div class="grid g4">${stat(st.ecoles, "Écoles", "buildings", "", "#/ecoles")}${stat(st.actives, "Écoles actives", "seal-check", "ok")}${stat(st.essai, "En période d'essai", "hourglass", "warn")}${stat(st.suspendues, "Suspendues", "warning-circle", "bad")}${stat(st.utilisateurs, "Utilisateurs", "users-three")}${stat(st.eleves, "Élèves", "student")}</div>
    <p style="margin-top:var(--s5)" class="row"><a class="btn" href="#/ecoles">${ib("buildings", "Gérer les écoles")}</a><a class="btn sec" href="#/finance">${ib("coins", "Finances des écoles")}</a></p>`;
    else if (r === "admin")
      body = `${st.demandes ? alertBox("user-plus", `<b>${st.demandes}</b> demande(s) de pré-inscription à examiner — <a href="#/preinscriptions">Examiner les demandes</a>`) : ""}${st.sans_classe ? alertBox("warning", `<b>${st.sans_classe}</b> élève(s) sans classe — <a href="#/eleves">Affecter</a>`) : ""}
    <div class="grid g4">${stat(st.eleves, "Élèves inscrits", "student", "", "#/eleves")}${stat(st.classes, "Classes", "users", "", "#/classes")}${stat(st.enseignants, "Enseignants", "chalkboard-teacher", "", "#/enseignants")}${stat(st.absences_30j, "Absences non justifiées (30 j)", "calendar-x", "warn", "#/absences")}</div>
    <h2 style="margin:var(--s6) 0 var(--s3)">Situation des paiements</h2><div class="grid g3">${stat(st.soldes.solde, "Élèves ayant tout payé", "seal-check", "ok", "#/impayes")}${stat(st.soldes.partiel, "Paiements partiels", "hourglass", "warn", "#/impayes")}${stat(st.soldes.impaye, "Élèves n'ayant rien payé", "warning-circle", "bad", "#/impayes")}</div>
    <div class="card" style="margin-top:var(--s6)"><h2>Effectifs par classe</h2>${st.effectifs.map((c) => `<div class="meter-row"><div class="row sp"><span>${niv(c.niveau)} ${esc(c.section)} ${c.effectif >= c.capacite ? badge("Complet", "bad") : ""}</span><b class="tnum">${c.effectif} / ${c.capacite}</b></div><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${c.capacite}" aria-valuenow="${c.effectif}" aria-label="Effectif ${niv(c.niveau)} ${esc(c.section)}"><i class="${c.effectif >= c.capacite ? "full" : ""}" style="width:${Math.min(100, (c.effectif / c.capacite) * 100)}%"></i></div></div>`).join("") || APP.empty("Aucune classe", "Créez une classe pour voir les effectifs.", "users")}</div>`;
    else if (r === "comptable")
      body = `<div class="grid g4">${stat(money(st.encaisse), "Encaissé (" + st.annee + ")", "coins", "ok", "#/paiements")}${stat(money(Math.max(0, st.du - st.encaisse)), "Reste à encaisser", "wallet", "warn", "#/impayes")}${stat(st.soldes.solde, "Élèves à jour", "seal-check", "ok")}${stat(st.soldes.partiel, "Paiements partiels", "hourglass", "warn")}${stat(st.soldes.impaye, "Rien payé", "warning-circle", "bad")}</div>
    <p class="row" style="margin-top:var(--s5)"><a class="btn" href="#/paiements">${ib("plus", "Enregistrer un paiement")}</a><a class="btn sec" href="#/impayes">${ib("wallet", "Suivi des impayés")}</a></p>`;
    else if (r === "enseignant")
      body = `<div class="grid g4">${stat(st.classes, "Mes classes", "users", "", "#/classes")}${stat(st.devoirs, "Devoirs en cours", "clipboard-text", "", "#/devoirs")}${stat(st.a_corriger, "Travaux à corriger", "pencil-simple-line", "warn", "#/devoirs")}${stat(st.non_lus, "Messages non lus", "envelope-simple", st.non_lus ? "info" : "", "#/messages")}</div>`;
    else if (r === "parent") {
      const so = await api("GET", "/paiements/soldes");
      body = `<div class="grid g2">${
        st.enfants
          .map((k) => {
            const s = so.find((x) => x.id === k.id);
            return `<div class="card"><div class="row" style="flex-wrap:nowrap;margin-bottom:var(--s3)"><span class="av" aria-hidden="true" style="width:48px;height:48px;font-size:var(--fs-base);margin:0">${APP.initials(k.prenom, k.nom)}</span><div><h2 style="margin:0">${esc(k.prenom)} ${esc(k.nom)}</h2><span class="mut sm">${s ? "Scolarité : " : "Pré-inscription en cours de validation"}</span> ${s ? (s.reste > 0 ? badge("Reste " + money(s.reste), "bad") : badge("Soldé", "ok")) : ""}</div></div><div class="row"><a class="btn sec sm" href="#/mesnotes">${ib("graduation-cap", "Notes & bulletins", 16)}</a><a class="btn sec sm" href="#/devoirs">${ib("clipboard-text", "Devoirs", 16)}</a><a class="btn sec sm" href="#/absences">${ib("calendar-x", "Absences", 16)}</a></div></div>`;
          })
          .join("") ||
        `<div class="card">${APP.empty("Aucun enfant rattaché", "Utilisez « Mes enfants » pour pré-inscrire un enfant.", "student")}</div>`
      }</div>
    <div class="grid g4" style="margin-top:var(--s4)">${stat(st.non_lus, "Messages non lus", "envelope-simple", st.non_lus ? "info" : "", "#/messages")}<a class="card stat link" href="#/mesdemandes"><div class="stat-ic">${ic("user-plus", 24)}</div><div><span>Pré-inscrire un enfant</span><b style="font-size:var(--fs-md)">Voir mes demandes</b></div></a></div>`;
    } else
      body = `<div class="grid g4">${stat(st.devoirs, "Devoirs à rendre", "clipboard-text", st.devoirs ? "warn" : "ok", "#/devoirs")}${stat(st.non_lus, "Messages non lus", "envelope-simple", st.non_lus ? "info" : "", "#/messages")}</div>`;
    if (r !== "superadmin") {
      const a = (await api("GET", "/messages?dossier=annonces")).slice(0, 4);
      ann = `<div class="card flush" style="margin-top:var(--s6)"><div class="toolbar"><h2 style="margin:0">Annonces</h2><a class="btn sec sm" href="#/messages">Tout voir</a></div>${a.length ? a.map((x) => `<div class="msg" data-ann="${x.id}" tabindex="0" role="button"><span class="dot" aria-hidden="true"></span><span class="subj">${esc(x.objet)}</span><span class="date">${fdt(x.sent_at)}</span><span class="meta">${esc(x.extrait)}</span></div>`).join("") : APP.empty("Aucune annonce", "Les annonces de la direction apparaîtront ici.", "megaphone")}</div>`;
    }
    main.innerHTML = `<div class="page-head"><div><h1>Bonjour, ${esc(S.user.prenom)}</h1><p class="page-sub">${esc(day.charAt(0).toUpperCase() + day.slice(1))}</p></div></div>${body}${ann}`;
    const open = (el) =>
      openMessage(el.dataset.ann, "annonces").catch((x) =>
        toast(x.message, "bad"),
      );
    main.onclick = (e) => {
      const a = e.target.closest("[data-ann]");
      if (a) open(a);
    };
    main.onkeydown = (e) => {
      if (e.key === "Enter" && e.target.dataset?.ann) open(e.target);
    };
  };

  // ═════════ Pré-inscriptions : formulaire public, suivi par le parent, validation par la direction ═════════
  const sexeOpts = [
    { v: "M", l: "Garçon" },
    { v: "F", l: "Fille" },
  ];
  const ecoleOpt = (e) => ({
    v: e.id,
    l: e.name + (e.adresse ? " — " + e.adresse.split(",").pop().trim() : ""),
  });
  const ageHelp = (y) =>
    `Âge minimum 6 ans : né en ${y - 6} ou avant (14 ans maximum)`;
  const telAttr = {
    pattern: "\\+?[0-9][0-9 ]{7,17}",
    title: "8 à 15 chiffres, espaces et + autorisés",
    ph: "+216 98 123 456",
    ac: "tel",
  };
  // ajuste les bornes de la date de naissance selon l'année scolaire de l'école choisie
  function wireBounds(root, prefix, ecoles) {
    const sel = $(`[name=${prefix}ecole_id]`, root),
      d = $(`[name=${prefix}date_naissance]`, root),
      h = $(`#h_${prefix}date_naissance`, root);
    const apply = () => {
      const e = ecoles.find((x) => String(x.id) === sel.value),
        y = e ? parseInt(e.annee_courante, 10) : 0;
      if (!y) {
        d.min = "";
        d.max = today();
        return;
      }
      d.min = `${y - 14}-01-01`;
      d.max = `${y - 6}-12-31`;
      if (h) h.textContent = ageHelp(y);
    };
    sel.addEventListener("change", apply);
    apply();
  }
  const kidFields = (p, ecoles) => [
    {
      k: p + "ecole_id",
      l: "École souhaitée",
      t: "select",
      req: true,
      o: ecoles.map(ecoleOpt),
      full: true,
      help: "Chaque enfant peut être inscrit dans une école différente.",
    },
    { k: p + "nom", l: "Nom", req: true, maxlength: 60, ac: "off" },
    { k: p + "prenom", l: "Prénom", req: true, maxlength: 60 },
    {
      k: p + "date_naissance",
      l: "Date de naissance",
      t: "date",
      req: true,
      max: today(),
      help: "Choisissez d'abord l'école pour connaître l'âge minimum.",
    },
    { k: p + "sexe", l: "Sexe", t: "select", req: true, o: sexeOpts },
    { k: p + "adresse", l: "Adresse", maxlength: 255, full: true },
    {
      k: p + "antecedents",
      l: "Antécédents médicaux (facultatif)",
      t: "textarea",
      maxlength: 1000,
      full: true,
    },
  ];
  const readKid = (f, p, scope) => {
    const g = (k) => f.elements[p + k].value.trim();
    return {
      ecole_id: +g("ecole_id"),
      nom: g("nom"),
      prenom: g("prenom"),
      date_naissance: g("date_naissance"),
      sexe: g("sexe"),
      adresse: g("adresse") || undefined,
      antecedents_medicaux: g("antecedents") || undefined,
    };
  };

  // Page PUBLIQUE (sans compte) : un parent dépose une pré-inscription et choisit l'école de chaque enfant
  APP.renderPreinscription = async () => {
    let ecoles = [];
    try {
      ecoles = await (await fetch("/api/public/ecoles")).json();
    } catch {}
    document.title = "Pré-inscription — Gestion d'école primaire";
    const pf = [
      {
        k: "p_prenom",
        l: "Prénom",
        req: true,
        maxlength: 60,
        ac: "given-name",
      },
      { k: "p_nom", l: "Nom", req: true, maxlength: 60, ac: "family-name" },
      {
        k: "p_email",
        l: "Adresse e-mail",
        t: "email",
        req: true,
        maxlength: 200,
        ac: "email",
        help: "Vos identifiants de connexion seront envoyés à cette adresse.",
      },
      { k: "p_telephone", l: "Téléphone", t: "tel", req: true, ...telAttr },
    ];
    $("#app").innerHTML =
      `<div class="pub"><header class="pub-top"><a class="brand-link" href="#/">${APP.mark(20)}<span>Gestion d'école primaire</span></a><div class="row"><a class="btn sec sm" href="#/">${ic("sign-out", 16)} <span>Se connecter</span></a>${APP.themeBtn()}</div></header>
    <main class="pub-main" id="main" tabindex="-1"><div id="pv"></div></main></div>`;
    let n = 0;
    const formView = () => {
      $("#pv").innerHTML =
        `<div class="pub-head"><h1>Pré-inscription d'un enfant</h1><p class="page-sub">Aucun compte à créer : remplissez ce formulaire. La direction de l'école vérifie votre demande, puis vous recevez vos identifiants de connexion <b>par e-mail</b>.</p></div>
      ${ecoles.length ? "" : `<div class="alert">${ic("warning", 20)}<span>Aucune école n'accepte de pré-inscription pour le moment. Réessayez plus tard.</span></div>`}
      <form id="pf" novalidate><section class="card"><h2>1. Le parent / tuteur</h2>${formHtml(pf)}</section>
      <section class="card"><h2>2. Votre ou vos enfants</h2><div id="kids"></div><button type="button" class="btn sec" id="addkid">${ib("plus", "Ajouter un autre enfant")}</button></section>
      <section class="card"><div class="f chk"><label><input type="checkbox" name="consentement" id="f_consentement" required> <span>Je suis le représentant légal de l'enfant et j'accepte que ces informations soient traitées par l'école pour examiner ma demande.<span class="req" aria-hidden="true">*</span></span></label></div>
        <div class="hp" aria-hidden="true"><label>Ne pas remplir<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <div class="err" id="pe" role="alert" hidden style="margin:0 0 var(--s4)"></div><button class="btn" id="send"${ecoles.length ? "" : " disabled"}>${ib("paper-plane-tilt", "Envoyer ma demande")}</button></section></form>`;
      const kids = $("#kids"),
        add = $("#addkid"),
        renum = () => {
          const c = $$(".child", kids);
          c.forEach((x, i) => {
            $(".cnum", x).textContent = i + 1;
            const rm = $("[data-rm]", x);
            rm.hidden = c.length < 2;
          });
          add.hidden = c.length >= 6;
        };
      const addKid = () => {
        const i = ++n,
          p = `c${i}_`;
        const w = document.createElement("fieldset");
        w.className = "child";
        w.dataset.c = i;
        w.innerHTML = `<legend>Enfant <span class="cnum"></span></legend>${formHtml(kidFields(p, ecoles), { [p + "ecole_id"]: ecoles.length === 1 ? ecoles[0].id : "" })}<button type="button" class="btn bad sm" data-rm>${ib("trash", "Retirer cet enfant", 16)}</button>`;
        kids.appendChild(w);
        wireBounds(w, p, ecoles);
        renum();
        return w;
      };
      addKid();
      add.onclick = () => $("input,select", addKid()).focus();
      kids.onclick = (e) => {
        const r = e.target.closest("[data-rm]");
        if (r) {
          r.closest(".child").remove();
          renum();
        }
      };
      $("#pf").onsubmit = async (ev) => {
        ev.preventDefault();
        const f = ev.target,
          btn = $("#send");
        $("#pe").hidden = true;
        btn.disabled = true;
        btn.classList.add("is-loading");
        try {
          const r = await api("POST", "/public/preinscriptions", {
            consentement: f.consentement.checked,
            website: f.website.value,
            parent: {
              nom: f.p_nom.value.trim(),
              prenom: f.p_prenom.value.trim(),
              email: f.p_email.value.trim(),
              telephone: f.p_telephone.value.trim(),
            },
            enfants: $$(".child", f).map((c) => readKid(f, `c${c.dataset.c}_`)),
          });
          $("#pv").innerHTML =
            `<div class="card" style="text-align:center;padding:var(--s7) var(--s5)"><div class="ok-big">${ic("check-circle", 36)}</div><h1 style="margin-bottom:var(--s3)">Demande envoyée</h1>
          <p>Votre demande a été transmise à : <b>${r.ecoles.map(esc).join(", ")}</b>.</p><ol class="steps" style="text-align:left;max-width:520px;margin:var(--s4) auto"><li>La direction vérifie votre demande.</li><li>Si elle est validée, les comptes du parent et de l'enfant sont créés automatiquement.</li><li>Vous recevez vos identifiants par e-mail à <b>${esc(f.p_email.value)}</b> (pensez à regarder vos courriers indésirables).</li></ol>
          <div class="row" style="justify-content:center"><a class="btn" href="#/">Retour à la connexion</a><button class="btn sec" id="again">Faire une autre demande</button></div></div>`;
          $("#again").onclick = () => {
            n = 0;
            formView();
          };
          window.scrollTo?.(0, 0);
          $("#main").focus();
        } catch (x) {
          $("#pe").innerHTML = ic("warning-circle", 20) + "<span></span>";
          $("#pe span").textContent = x.message;
          $("#pe").hidden = false;
          $("#pe").scrollIntoView?.({ block: "center" });
        } finally {
          btn.disabled = false;
          btn.classList.remove("is-loading");
        }
      };
    };
    formView();
  };

  // Parent connecté : nouvelle demande pour un autre enfant (dans la même école ou une autre)
  async function parentRequestModal() {
    const ecoles = await api("GET", "/public/ecoles"),
      own = S.user.school?.id;
    const fields = [
      ...kidFields("", ecoles).map((f) =>
        f.k === "ecole_id"
          ? {
              ...f,
              help: "Vous pouvez choisir une autre école que celle de votre compte.",
            }
          : f,
      ),
      { k: "telephone", l: "Votre téléphone", t: "tel", req: true, ...telAttr },
    ];
    const m = modal(
      "Pré-inscrire un enfant",
      formHtml(fields, {
        ecole_id: ecoles.some((e) => e.id === own) ? own : "",
        telephone: S.user.telephone || "",
      }) +
        '<p class="mut sm">La demande est transmise à la direction de l\'école choisie. Vous serez informé(e) de la décision ; suivez-la dans « Mes demandes ».</p>',
      {
        label: "Envoyer la demande",
        onSubmit: async (f) => {
          await api("POST", "/public/preinscriptions", {
            consentement: true,
            parent: {
              nom: S.user.nom,
              prenom: S.user.prenom,
              email: S.user.email,
              telephone: f.telephone.value.trim(),
            },
            enfants: [readKid(f, "")],
          });
          toast("Demande envoyée à la direction", "ok");
          if (location.hash !== "#/mesdemandes")
            location.hash = "#/mesdemandes";
          else APP.route();
        },
      },
    );
    wireBounds(m, "", ecoles);
  }
  const STATUT_PRE = {
    en_attente: ["À l'examen", "warn"],
    validee: ["Validée", "ok"],
    refusee: ["Refusée", "bad"],
  };
  P.mesdemandes = resource({
    title: "Mes demandes de pré-inscription",
    sub: "Suivi de vos demandes dans toutes les écoles. Une fois validée, l'enfant apparaît dans « Mes enfants » (pour une autre école, connectez-vous avec les identifiants reçus par e-mail).",
    singular: "demande",
    path: "/mes-preinscriptions",
    cols: [
      col("Déposée le", (r) => fdt(r.created_at)),
      col("École", (r) => r.ecole),
      col("Enfant", (r) => `${r.enfant_prenom} ${r.enfant_nom}`),
      col("Naissance", (r) => fdate(r.date_naissance)),
      col(
        "Décision",
        (r) =>
          badge(...STATUT_PRE[r.statut]) +
          (r.statut === "refusee" && r.motif_refus
            ? `<div class="sm mut" style="margin-top:4px">Motif : ${esc(r.motif_refus)}</div>`
            : ""),
        true,
      ),
    ],
    toolbar: (tb) => {
      const b = document.createElement("button");
      b.className = "btn";
      b.innerHTML = ib("user-plus", "Pré-inscrire un enfant");
      b.onclick = () => parentRequestModal();
      tb.appendChild(b);
    },
  });

  // Direction : examen des demandes
  const copyBtn = (v) =>
    `<button type="button" class="btn sec sm" data-copy="${esc(v)}">${ib("file-text", "Copier", 14)}</button>`;
  function resultModal(r, pre) {
    const box = (titre, c) =>
      `<div class="cred"><div class="cred-h">${titre}</div><dl><dt>Identifiant</dt><dd><code>${esc(c.login)}</code>${copyBtn(c.login)}</dd><dt>Mot de passe temporaire</dt><dd><code>${esc(c.motdepasse)}</code>${copyBtn(c.motdepasse)}</dd></dl></div>`;
    const mail =
      r.email_statut === "envoye"
        ? alertBox(
            "check-circle",
            `Identifiants envoyés par e-mail à <b>${esc(r.email)}</b>.`,
            "info",
          )
        : r.email_statut === "non_configure"
          ? alertBox(
              "warning",
              `L'envoi d'e-mails n'est pas configuré (clé <code>SENDGRID_API_KEY</code>). <b>Transmettez ces identifiants à la famille</b> (${esc(r.email)}).`,
            )
          : alertBox(
              "warning",
              `L'e-mail n'a pas pu être envoyé (${esc(r.email_statut)}). <b>Transmettez ces identifiants à la famille</b> (${esc(r.email)}).`,
            );
    const m = modal(
      "Inscription validée",
      `<p><b>${esc(r.eleve.prenom)} ${esc(r.eleve.nom)}</b> est inscrit(e) — matricule <b>${esc(r.eleve.matricule)}</b>${r.eleve.classe ? ` en <b>${esc(r.eleve.classe)}</b>` : ' <span class="mut">(sans classe : à affecter dans « Élèves »)</span>'}.</p>
    ${r.reinscription ? `<p class="mut">Enfant déjà inscrit : son dossier existant est conservé.</p>` : ""}
    ${r.identifiants.parent ? box("Compte parent (nouveau)", r.identifiants.parent) : `<p>${ic("check-circle", 18)} Le parent utilise son <b>compte existant</b> : aucun nouveau compte parent.</p>`}
    ${r.identifiants.eleve ? box(`Compte élève (${esc(r.eleve.prenom)})`, r.identifiants.eleve) : ""}
    ${r.identifiants.parent || r.identifiants.eleve ? mail + '<p class="mut sm">Ces mots de passe ne seront plus affichés. À la première connexion, il sera demandé de les changer.</p>' : ""}`,
      { wide: true },
    );
    m.addEventListener("click", (e) => {
      const b = e.target.closest("[data-copy]");
      if (b)
        navigator.clipboard?.writeText(b.dataset.copy).then(
          () => toast("Copié", "ok"),
          () => toast("Copie impossible : sélectionnez le texte", "bad"),
        );
    });
  }
  async function validerModal(r, load) {
    const classes = await api("GET", "/classes?annee_scolaire=" + APP.year());
    const fl = [
      {
        k: "classe_id",
        l: "Classe",
        t: "select",
        empty: "Affectation automatique selon l'âge",
        o: classes.map((c) => ({
          v: c.id,
          l: `${niv(c.niveau)} ${c.section} — ${c.effectif}/${c.capacite} élèves${c.effectif >= c.capacite ? " (complète)" : ""}`,
        })),
        full: true,
      },
    ];
    modal(
      `Valider — ${r.enfant_prenom} ${r.enfant_nom}`,
      `<ul class="steps" style="color:var(--text)"><li>${r.parent_existe ? "Le parent a <b>déjà un compte</b> : il sera réutilisé." : "Un <b>compte parent</b> sera créé pour <b>" + esc(r.parent_email) + "</b>."}</li>
    <li>${r.enfant_existe ? "Cet enfant est <b>déjà inscrit</b> : son dossier et son compte seront conservés." : "Le <b>dossier élève</b> et son <b>compte élève</b> seront créés automatiquement (une seule fois)."}</li><li>Les identifiants seront envoyés par e-mail au parent.</li></ul>${r.enfant_existe ? "" : formHtml(fl)}`,
      {
        label: "Valider et créer les comptes",
        onSubmit: async (f) => {
          const res = await api("POST", `/preinscriptions/${r.id}/valider`, {
            classe_id: f.classe_id?.value || undefined,
          });
          await load();
          setTimeout(() => resultModal(res, r), 220);
        },
      },
    );
  }
  const preCfg = {
    title: "Demandes de pré-inscription",
    sub: "Vérifiez les demandes déposées par les familles. À la validation, les comptes parent et élève sont créés automatiquement (une seule fois) et les identifiants sont envoyés par e-mail.",
    singular: "demande",
    path: "/preinscriptions?statut=en_attente",
    base: "/preinscriptions",
    cols: [
      col("Reçue le", (r) => fdate(r.created_at)),
      col(
        "Parent",
        (r) =>
          `<b>${esc(r.parent_prenom)} ${esc(r.parent_nom)}</b><div class="sm mut">${esc(r.parent_email)} · ${esc(r.parent_telephone)}</div>${r.parent_existe ? badge("Compte existant", "info") : ""}`,
        true,
      ),
      col(
        "Enfant",
        (r) =>
          `<b>${esc(r.enfant_prenom)} ${esc(r.enfant_nom)}</b><div class="sm mut">${r.sexe === "F" ? "Fille" : "Garçon"}</div>`,
        true,
      ),
      col(
        "Naissance",
        (r) =>
          `${fdate(r.date_naissance)}<div class="sm mut">${Math.floor((Date.now() - new Date(r.date_naissance)) / 31557600000)} ans</div>`,
        true,
      ),
      col(
        "Statut",
        (r) =>
          badge(...STATUT_PRE[r.statut]).replace("À l'examen", "À examiner") +
          (r.motif_refus
            ? `<div class="sm mut" style="margin-top:4px">Motif : ${esc(r.motif_refus)}</div>`
            : ""),
        true,
      ),
    ],
    actions: [
      {
        l: ib("check", "Valider", 16),
        show: (r) => r.statut === "en_attente",
        fn: validerModal,
      },
      {
        l: ib("x", "Refuser", 16),
        show: (r) => r.statut === "en_attente",
        fn: (r, load) =>
          modal(
            `Refuser — ${r.enfant_prenom} ${r.enfant_nom}`,
            formHtml([
              {
                k: "motif",
                l: "Motif du refus (communiqué au parent)",
                t: "textarea",
                req: true,
                minlength: 3,
                maxlength: 300,
                full: true,
              },
            ]),
            {
              label: "Refuser la demande",
              danger: true,
              onSubmit: async (f) => {
                await api("POST", `/preinscriptions/${r.id}/refuser`, {
                  motif: f.motif.value.trim(),
                });
                toast("Demande refusée, le parent est averti", "ok");
                await load();
              },
            },
          ),
      },
    ],
    toolbar: (tb, load) => {
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", "Filtrer par statut");
      sel.style.width = "auto";
      sel.innerHTML = [
        ["en_attente", "À examiner"],
        ["validee", "Validées"],
        ["refusee", "Refusées"],
        ["", "Toutes"],
      ]
        .map((o) => `<option value="${o[0]}">${o[1]}</option>`)
        .join("");
      sel.onchange = () => {
        preCfg.path =
          "/preinscriptions" + (sel.value ? "?statut=" + sel.value : "");
        load();
      };
      tb.appendChild(sel);
    },
  };
  P.preinscriptions = resource(preCfg);
})();
