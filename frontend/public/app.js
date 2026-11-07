// Noyau de l'interface : API, composants (modale, formulaires, validation), thème, connexion, navigation, notifications.
"use strict";
const APP = (window.APP = { PAGES: {}, NAV: [] });
const $ = (s, e = document) => e.querySelector(s);
const $$ = (s, e = document) => [...e.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const S = (APP.S = {
  token: localStorage.getItem("token"),
  user: JSON.parse(localStorage.getItem("user") || "null"),
});
Object.assign(APP, { $, $$, esc });

const ROLES = (APP.ROLES = {
  superadmin: "Super-administrateur",
  admin: "Direction",
  comptable: "Comptabilité",
  enseignant: "Enseignant",
  parent: "Parent",
  eleve: "Élève",
});
APP.fdate = (d) =>
  d ? String(d).slice(0, 10).split("-").reverse().join("/") : "";
APP.fdt = (d) =>
  d
    ? new Date(d).toLocaleString("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";
APP.money = (n) =>
  Number(n || 0).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " TND";
APP.niv = (n) => (n == 1 ? "1ère année" : n + "ème année");
APP.classe = (r) =>
  r.classe_niveau ? `${APP.niv(r.classe_niveau)} ${r.classe_section}` : "—";
APP.year = () => S.user?.school?.annee_courante || "";
APP.startYear = () => parseInt(APP.year().slice(0, 4), 10);
APP.has = (...roles) => roles.includes(S.user?.role);
APP.initials = (p, n) =>
  esc(((p || "")[0] || "") + ((n || "")[0] || "")).toUpperCase();

// ───── Icônes (Phosphor, un seul jeu cohérent) ─────
const icon = (APP.icon = (name, size = 20, cls = "") =>
  `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false">${(window.ICONS || {})[name] || ""}</svg>`);

// ───── Thème clair / sombre ─────
const isDark = () => document.documentElement.dataset.theme === "dark";
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("theme", t);
  } catch {}
  $("meta[name=theme-color]")?.setAttribute(
    "content",
    t === "dark" ? "#0b1020" : "#f5f6fa",
  );
  $$("[data-theme-toggle]").forEach((b) => {
    b.innerHTML = icon(t === "dark" ? "sun" : "moon");
    b.setAttribute(
      "aria-label",
      t === "dark" ? "Activer le thème clair" : "Activer le thème sombre",
    );
  });
}
const themeBtn = () =>
  `<button type="button" class="icon-btn" data-theme-toggle aria-label="${isDark() ? "Activer le thème clair" : "Activer le thème sombre"}">${icon(isDark() ? "sun" : "moon")}</button>`;

// ───── API ─────
async function api(method, path, body) {
  const opt = { method, headers: {} };
  if (S.token) opt.headers.Authorization = "Bearer " + S.token;
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  let r;
  try {
    r = await fetch("/api" + path, opt);
  } catch {
    throw new Error(
      "Serveur injoignable, vérifiez votre connexion et réessayez",
    );
  }
  const data = (r.headers.get("content-type") || "").includes("json")
    ? await r.json()
    : null;
  if (r.status === 401 && S.token) {
    logout();
    throw new Error(data?.error || "Session expirée");
  }
  if (!r.ok) {
    const e = new Error(data?.error || "Erreur " + r.status);
    e.status = r.status;
    throw e;
  }
  return data;
}
async function fetchBlob(path) {
  const r = await fetch("/api" + path, {
    headers: { Authorization: "Bearer " + S.token },
  });
  if (!r.ok) {
    let m = "Téléchargement impossible";
    try {
      m = (await r.json()).error;
    } catch {}
    throw new Error(m);
  }
  const cd = /filename\*=UTF-8''([^;]+)/.exec(
    r.headers.get("content-disposition") || "",
  );
  return { blob: await r.blob(), name: cd ? decodeURIComponent(cd[1]) : null };
}
async function download(path, fallbackName) {
  try {
    const { blob, name } = await fetchBlob(path),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name || fallbackName || "fichier";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  } catch (e) {
    toast(e.message, "bad");
  }
}
async function hydrateImages(root = document) {
  // les photos exigent l'authentification : chargées en blob
  for (const img of $$("img[data-photo]", root)) {
    try {
      img.src = URL.createObjectURL(
        (await fetchBlob("/fichiers/" + img.dataset.photo)).blob,
      );
    } catch {}
    img.removeAttribute("data-photo");
  }
}
Object.assign(APP, { api, download, hydrateImages });

// ───── Retours utilisateur ─────
function toast(msg, type = "") {
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.innerHTML = `${icon(type === "ok" ? "check-circle" : type === "bad" ? "warning-circle" : "info", 20)}<p></p><button type="button" class="icon-btn" aria-label="Fermer la notification">${icon("x", 14)}</button>`;
  $("p", t).textContent = msg;
  $("button", t).onclick = () => t.remove();
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), type === "bad" ? 6500 : 4000);
}
APP.toast = toast;
APP.badge = (t, c = "") => `<span class="badge ${c}">${esc(t)}</span>`;
APP.skeleton = () =>
  `<div class="sk sk-title"></div><div class="grid g4">${'<div class="sk sk-card"></div>'.repeat(4)}</div><div class="card flush" style="margin-top:16px">${'<div class="sk sk-row"></div>'.repeat(5)}</div>`;
APP.empty = (title, hint = "", ic = "tray") =>
  `<div class="empty"><div class="ic-wrap">${icon(ic, 28)}</div><b>${esc(title)}</b>${hint ? `<span>${esc(hint)}</span>` : ""}</div>`;

// ───── Validation des formulaires (erreur sous le champ, messages précis) ─────
const dmy = (v) => APP.fdate(v);
function messageFor(el) {
  const v = el.validity;
  if (v.valueMissing)
    return el.type === "checkbox"
      ? "Cochez cette case pour continuer"
      : el.tagName === "SELECT"
        ? "Choisissez une option dans la liste"
        : el.type === "file"
          ? "Sélectionnez un fichier"
          : "Ce champ est obligatoire";
  if (v.typeMismatch)
    return el.type === "email"
      ? "Adresse e-mail invalide (exemple : nom@ecole.tn)"
      : "Format invalide";
  if (v.patternMismatch)
    return el.title ? `Format attendu : ${el.title}` : "Format invalide";
  if (v.tooShort)
    return `Au moins ${el.minLength} caractères (actuellement ${el.value.length})`;
  if (v.tooLong) return `${el.maxLength} caractères maximum`;
  const date = el.type === "date" || el.type === "time";
  if (v.rangeUnderflow)
    return date
      ? `Valeur minimale : ${el.type === "date" ? dmy(el.min) : el.min}`
      : `La valeur doit être au moins ${el.min}`;
  if (v.rangeOverflow)
    return date
      ? `Valeur maximale : ${el.type === "date" ? dmy(el.max) : el.max}`
      : `La valeur doit être au plus ${el.max}`;
  if (v.stepMismatch) return `Valeur non valide (pas de ${el.step})`;
  if (v.badInput) return "Valeur invalide";
  return el.validationMessage || "Valeur invalide";
}
function setErr(el, msg) {
  const box = el.closest(".f") || el.parentElement;
  let p = $(".f-err", box);
  const help = $("small[id]", box);
  if (!msg) {
    p?.remove();
    el.removeAttribute("aria-invalid");
    help
      ? el.setAttribute("aria-describedby", help.id)
      : el.removeAttribute("aria-describedby");
    return;
  }
  if (!p) {
    p = document.createElement("p");
    p.className = "f-err";
    p.id = "err_" + (el.name || el.id || Math.random().toString(36).slice(2));
    box.appendChild(p);
  }
  p.innerHTML = icon("warning-circle", 16) + "<span></span>";
  $("span", p).textContent = msg;
  el.setAttribute("aria-invalid", "true");
  el.setAttribute(
    "aria-describedby",
    [help?.id, p.id].filter(Boolean).join(" "),
  );
}
APP.validate = (form) => {
  let first = null;
  const bad = [];
  for (const el of [...form.elements]) {
    if (
      !el.willValidate ||
      el.disabled ||
      el.type === "hidden" ||
      el.type === "submit" ||
      el.type === "button"
    )
      continue;
    if (el.checkValidity()) setErr(el, "");
    else {
      setErr(el, messageFor(el));
      bad.push(el);
      first ||= el;
    }
  }
  if (first) {
    first.focus();
    first.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }
  return { ok: !bad.length, count: bad.length };
};
document.addEventListener("focusout", (e) => {
  const el = e.target;
  if (
    el.form?.noValidate &&
    el.willValidate &&
    (el.value || el.getAttribute("aria-invalid"))
  )
    setErr(el, el.checkValidity() ? "" : messageFor(el));
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.getAttribute?.("aria-invalid") && el.checkValidity()) setErr(el, "");
});
document.addEventListener(
  "submit",
  (e) => {
    // formulaires hors modale (connexion, profil, paramètres)
    const f = e.target;
    if (!f.noValidate || f.closest(".modal")) return;
    if (!APP.validate(f).ok) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  },
  true,
);

// ───── Modale accessible : piège de focus, retour du focus, feuille basse sur mobile ─────
let modalId = 0;
APP.modal = function (
  title,
  html,
  {
    onSubmit,
    label = "Enregistrer",
    wide,
    extra = [],
    closeLabel = "Annuler",
    danger = false,
  } = {},
) {
  const trigger = document.activeElement,
    id = ++modalId,
    el = document.createElement("div");
  let dirty = false;
  el.className = "overlay";
  el.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="mt${id}"><div class="modal-head"><h2 id="mt${id}">${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Fermer la fenêtre">${icon("x")}</button></div>
    <form novalidate><div class="body">${html}</div><div class="err" role="alert" hidden></div><footer><button type="button" class="btn sec" data-close>${onSubmit ? closeLabel : "Fermer"}</button>
    ${extra.map((x) => `<button type="button" class="btn sec" data-extra="${x.id}">${esc(x.label)}</button>`).join("")}${onSubmit ? `<button class="btn ${danger ? "danger" : ""}" type="submit">${esc(label)}</button>` : ""}</footer></form></div>`;
  document.body.appendChild(el);
  document.body.classList.add("noscroll");
  const form = $("form", el),
    err = $(".err", el);
  const finish = () => {
    el.classList.add("closing");
    setTimeout(() => {
      el.remove();
      if (!$(".overlay")) document.body.classList.remove("noscroll");
      if (trigger?.isConnected) trigger.focus?.();
    }, 120);
  };
  el.close = finish;
  el.requestClose = () => {
    if (
      dirty &&
      onSubmit &&
      !window.confirm("Abandonner les modifications non enregistrées ?")
    )
      return;
    finish();
  };
  el.fail = (m) => {
    err.innerHTML = icon("warning-circle", 20) + "<span></span>";
    $("span", err).textContent = m;
    err.hidden = false;
    err.scrollIntoView?.({ block: "nearest" });
  };
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]") || e.target === el) el.requestClose();
  });
  form.addEventListener("input", () => {
    dirty = true;
  });
  el.addEventListener("keydown", (e) => {
    // piège de focus
    if (e.key !== "Tab") return;
    const f = $$(
      'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      el,
    ).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const a = f[0],
      z = f.at(-1);
    if (e.shiftKey && document.activeElement === a) {
      e.preventDefault();
      z.focus();
    } else if (!e.shiftKey && document.activeElement === z) {
      e.preventDefault();
      a.focus();
    }
  });
  $$("[data-extra]", el).forEach((b) =>
    b.addEventListener("click", () => {
      form.dataset.mode = b.dataset.extra;
      form.requestSubmit();
    }),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!onSubmit) return;
    err.hidden = true;
    const v = APP.validate(form);
    if (!v.ok) {
      form.dataset.mode = "";
      return el.fail(
        v.count > 1
          ? `${v.count} champs sont à corriger avant de continuer.`
          : "Un champ est à corriger avant de continuer.",
      );
    }
    const btns = $$("footer button", form),
      submit = $("[type=submit]", form);
    btns.forEach((b) => (b.disabled = true));
    submit?.classList.add("is-loading");
    try {
      if ((await onSubmit(form, el)) !== false) {
        dirty = false;
        finish();
      }
    } catch (x) {
      el.fail(x.message);
    } finally {
      btns.forEach((b) => (b.disabled = false));
      submit?.classList.remove("is-loading");
      form.dataset.mode = "";
    }
  });
  setTimeout(
    () =>
      (
        el.querySelector(
          ".body input:not([type=hidden]):not([type=file]),.body select,.body textarea",
        ) || $("footer .btn:last-child", el)
      )?.focus(),
    40,
  );
  return el;
};
APP.confirm = (msg, label = "Confirmer", danger) =>
  new Promise((res) => {
    let done = false;
    const m = APP.modal("Confirmation", `<p style="margin:0">${esc(msg)}</p>`, {
      label,
      danger: danger ?? /supprim|effac/i.test(label),
      onSubmit: async () => {
        done = true;
        res(true);
      },
    });
    new MutationObserver((_, o) => {
      if (!m.isConnected) {
        if (!done) res(false);
        o.disconnect();
      }
    }).observe(document.body, { childList: true });
  });

// ───── Formulaires pilotés par une description de champs ─────
// f = { k, l, t: text|email|tel|password|number|date|time|select|textarea|checkbox|file, req, min, max, step, pattern, maxlength, o:[{v,l}], help, full }
APP.field = (f, v) => {
  const id = "f_" + f.k,
    hid = f.help ? `h_${f.k}` : "";
  const a = `name="${f.k}" id="${id}"${f.req ? " required" : ""}${f.min !== undefined ? ` min="${f.min}"` : ""}${f.max !== undefined ? ` max="${f.max}"` : ""}${f.step ? ` step="${f.step}"` : ""}${f.pattern ? ` pattern="${f.pattern}"` : ""}${f.maxlength ? ` maxlength="${f.maxlength}"` : ""}${f.minlength ? ` minlength="${f.minlength}"` : ""}${f.ph ? ` placeholder="${esc(f.ph)}"` : ""}${f.title ? ` title="${esc(f.title)}"` : ""}${hid ? ` aria-describedby="${hid}"` : ""}`;
  let inp;
  if (f.t === "select")
    inp = `<select ${a}>${f.req && v !== undefined && v !== null && v !== "" ? "" : '<option value="">' + (f.empty || "— Choisir —") + "</option>"}${(f.o || []).map((o) => `<option value="${esc(o.v)}"${String(o.v) === String(v ?? "") ? " selected" : ""}>${esc(o.l)}</option>`).join("")}</select>`;
  else if (f.t === "textarea")
    inp = `<textarea ${a} rows="${f.rows || 3}">${esc(v)}</textarea>`;
  else if (f.t === "checkbox")
    return `<div class="f chk ${f.full ? "full" : ""}"><label><input type="checkbox" name="${f.k}" id="${id}"${v ? " checked" : ""}${f.req ? " required" : ""}> <span>${f.html || esc(f.l)}</span></label></div>`;
  else if (f.t === "file")
    inp = `<input type="file" ${a}${f.multiple ? " multiple" : ""}${f.accept ? ` accept="${f.accept}"` : ""}>`;
  else if (f.t === "password")
    inp = `<div class="pw"><input type="password" ${a} value="${esc(v)}" autocomplete="${f.ac || "new-password"}"><button type="button" class="icon-btn" data-pw aria-label="Afficher le mot de passe" aria-pressed="false">${icon("eye")}</button></div>`;
  else
    inp = `<input type="${f.t || "text"}" ${a} value="${esc(v)}"${f.ac ? ` autocomplete="${f.ac}"` : ""}>`;
  return `<div class="f ${f.full ? "full" : ""}"><label for="${id}">${esc(f.l)}${f.req ? '<span class="req" aria-hidden="true">*</span>' : ""}</label>${inp}${f.help ? `<small id="${hid}">${esc(f.help)}</small>` : ""}</div>`;
};
APP.formHtml = (fields, vals = {}) =>
  `<div class="fg">${fields
    .filter((f) => !f.hide)
    .map((f) => APP.field(f, vals[f.k]))
    .join("")}</div>`;
APP.readForm = (form, fields) => {
  const o = {};
  for (const f of fields) {
    if (f.hide || f.t === "file") continue;
    const el = form.elements[f.k];
    if (!el) continue;
    o[f.k] =
      f.t === "checkbox"
        ? el.checked
        : f.t === "password"
          ? el.value
          : el.value.trim();
  }
  return o;
};
APP.opts = async (path, label, filter) =>
  (await api("GET", path))
    .filter(filter || (() => true))
    .map((r) => ({ v: r.id, l: label(r) }));
document.addEventListener("click", (e) => {
  const pw = e.target.closest("[data-pw]");
  if (pw) {
    const inp = $("input", pw.parentElement),
      show = inp.type === "password";
    inp.type = show ? "text" : "password";
    pw.setAttribute("aria-pressed", show);
    pw.setAttribute(
      "aria-label",
      show ? "Masquer le mot de passe" : "Afficher le mot de passe",
    );
    pw.innerHTML = icon(show ? "eye-slash" : "eye");
  }
  if (e.target.closest("[data-theme-toggle]"))
    setTheme(isDark() ? "light" : "dark");
  if (!e.target.closest(".menu-wrap"))
    $$(".menu-wrap .dd").forEach((d) => {
      d.hidden = true;
      $("[aria-expanded]", d.parentElement)?.setAttribute(
        "aria-expanded",
        "false",
      );
    });
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const o = $$(".overlay:not(.closing)").at(-1);
  if (o) return o.requestClose?.();
  $$(".menu-wrap .dd:not([hidden])").forEach((d) => {
    d.hidden = true;
    const b = $("[aria-expanded]", d.parentElement);
    b?.setAttribute("aria-expanded", "false");
    b?.focus();
  });
  $("#side")?.classList.remove("open");
  $("#scrim")?.classList.remove("show");
});

// ───── Notifications ─────
let lastNotif = 0,
  notifTimer;
async function pollNotifs() {
  if (!S.token || S.user.role === "superadmin") return;
  try {
    const d = await api("GET", "/notifications"),
      n = $("#bellN"),
      b = $("#bell");
    if (n) {
      n.textContent = d.non_lues > 99 ? "99+" : d.non_lues;
      n.hidden = !d.non_lues;
    }
    b?.setAttribute(
      "aria-label",
      d.non_lues
        ? `Notifications, ${d.non_lues} non lue${d.non_lues > 1 ? "s" : ""}`
        : "Notifications",
    );
    const newest = d.items[0]?.id || 0;
    if (
      lastNotif &&
      newest > lastNotif &&
      "Notification" in window &&
      Notification.permission === "granted"
    )
      d.items
        .filter((i) => i.id > lastNotif && !i.lu)
        .forEach(
          (i) =>
            new Notification(i.titre, {
              body: i.texte || "",
              icon: "icon.svg",
            }),
        );
    lastNotif = Math.max(lastNotif, newest);
    APP.notifs = d.items;
  } catch {}
}

// ───── Authentification & coquille ─────
const showPublic = () =>
  location.hash === "#/preinscription" && APP.renderPreinscription
    ? APP.renderPreinscription()
    : location.hash === "#/mot-de-passe-oublie"
      ? renderForgot()
      : renderLogin();
window.addEventListener("hashchange", () => {
  if (!S.token) showPublic();
});
function logout() {
  S.token = null;
  S.user = null;
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  clearInterval(notifTimer);
  lastNotif = 0;
  document.title = "Gestion d'école primaire";
  history.replaceState(null, "", location.pathname);
  renderLogin();
}
const DEMO = [
  ["Direction", "admin@aboukacem.tn"],
  ["Comptable", "comptable@aboukacem.tn"],
  ["Enseignant", "bensalah@aboukacem.tn"],
  ["Parent", "hammami@aboukacem.tn"],
  ["Élève", "youssef.hammami@aboukacem.tn"],
  ["École B", "admin@ibnkhaldoun.tn"],
  ["Super-admin", "super@ecole-saas.tn"],
];
APP.themeBtn = themeBtn;
const mark = (APP.mark = (s = 22) =>
  `<span class="mark">${icon("graduation-cap", s)}</span>`);
async function renderLogin() {
  let demo = true;
  try {
    demo = (await (await fetch("/api/config")).json()).demo;
  } catch {}
  $("#app").innerHTML =
    `<div class="auth"><aside class="auth-brand" aria-label="Présentation"><div>${mark(26)}<h1>Gérez votre école en toute sérénité</h1><p>Inscriptions, notes, paiements et communication avec les familles : une seule application, claire et sécurisée.</p>
    <ul class="feat"><li>${icon("shield-check", 22)}<span><b>Données isolées par école</b>Chaque établissement ne voit que ses propres données.</span></li><li>${icon("chart-bar", 22)}<span><b>Suivi pédagogique complet</b>Notes, bulletins PDF, absences et devoirs.</span></li><li>${icon("envelope-simple", 22)}<span><b>Messagerie intégrée</b>Enseignants, parents et administration connectés.</span></li></ul></div>
    <small style="position:relative;z-index:1;color:#94a3b8">© ${new Date().getFullYear()} Gestion d'école primaire</small></aside>
    <main class="auth-panel" id="main"><div class="auth-theme">${themeBtn()}</div><div class="auth-card"><h2>Connexion</h2><p class="mut">Connectez-vous à votre espace personnel.</p>
    <form id="lf" novalidate><div class="f"><label for="em">Adresse e-mail<span class="req" aria-hidden="true">*</span></label><input id="em" name="email" type="email" required autocomplete="username" inputmode="email"></div>
    <div class="f"><label for="pw">Mot de passe<span class="req" aria-hidden="true">*</span></label><div class="pw"><input id="pw" name="password" type="password" required autocomplete="current-password"><button type="button" class="icon-btn" data-pw aria-label="Afficher le mot de passe" aria-pressed="false">${icon("eye")}</button></div></div>
    <p class="auth-alt" style="text-align:right;margin:calc(var(--s2) * -1) 0 var(--s4)"><a href="#/mot-de-passe-oublie">Mot de passe oublié ?</a></p>
    <div class="err" id="le" role="alert" hidden style="margin:0 0 var(--s4)"></div><button class="btn" id="lb">Se connecter</button></form>
    <p class="auth-alt">Nouveau parent ? <a href="#/preinscription">${icon("user-plus", 16)} Pré-inscrire mon enfant</a></p>
    ${demo ? `<div class="demo"><b>Comptes de démonstration</b>Mot de passe : <code>Demo@2026</code> (super-admin : <code>Super@2026</code>). Cliquez pour remplir le formulaire.<div class="chips">${DEMO.map((d) => `<button type="button" class="chip" data-em="${d[1]}">${d[0]}</button>`).join("")}</div></div>` : ""}</div></main></div>`;
  $$("[data-em]").forEach(
    (b) =>
      (b.onclick = () => {
        $("#em").value = b.dataset.em;
        $("#pw").value = b.dataset.em.startsWith("super@")
          ? "Super@2026"
          : "Demo@2026";
        $("#lb").focus();
      }),
  );
  $("#lf").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target,
      btn = $("#lb");
    btn.disabled = true;
    btn.classList.add("is-loading");
    $("#le").hidden = true;
    try {
      const d = await api("POST", "/auth/login", {
        email: f.email.value,
        password: f.password.value,
        school_id: f.school_id?.value,
      });
      if (d.choix_ecole) {
        // même e-mail et même mot de passe dans plusieurs écoles : choix de l'école
        if (!f.school_id)
          $("#lb").insertAdjacentHTML(
            "beforebegin",
            `<div class="f"><label for="sc">Votre école<span class="req" aria-hidden="true">*</span></label><select id="sc" name="school_id" required><option value="">— Choisir —</option>${d.choix_ecole.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")}</select><small>Ce compte existe dans plusieurs écoles.</small></div>`,
          );
        $("#sc").focus();
        return;
      }
      S.token = d.token;
      S.user = d.user;
      localStorage.setItem("token", d.token);
      localStorage.setItem("user", JSON.stringify(d.user));
      location.hash = "#/";
      boot();
    } catch (x) {
      $("#le").innerHTML = icon("warning-circle", 20) + "<span></span>";
      $("#le span").textContent = x.message;
      $("#le").hidden = false;
    } finally {
      btn.disabled = false;
      btn.classList.remove("is-loading");
    }
  };
}

function renderForgot() {
  $("#app").innerHTML =
    `<div class="auth"><aside class="auth-brand" aria-hidden="true"><div>${mark(26)}<h1>Mot de passe oublié ?</h1><p>Nous vérifions votre identité grâce à un code envoyé à votre adresse e-mail.</p></div></aside>
    <main class="auth-panel" id="main"><div class="auth-theme">${themeBtn()}</div><div class="auth-card"><h2>Récupérer mon mot de passe</h2><div id="fp"></div>
    <p class="auth-alt"><a href="#/">Retour à la connexion</a></p></div></main></div>`;
  const showErr = (m) => {
    const el = $("#fperr");
    el.innerHTML = icon("warning-circle", 20) + "<span></span>";
    $("span", el).textContent = m;
    el.hidden = false;
  };
  const errBox =
    '<div class="err" id="fperr" role="alert" hidden style="margin:0 0 var(--s4)"></div>';

  const step1 = () => {
    $("#fp").innerHTML =
      `<p class="mut">Saisissez l'adresse e-mail de votre compte : un code de vérification à 6 chiffres vous sera envoyé.</p>
      <form id="f1" novalidate>${APP.formHtml([{ k: "email", l: "Adresse e-mail", t: "email", req: true, ac: "username" }])}${errBox}<button class="btn">Envoyer le code</button></form>`;
    $("#f1").onsubmit = async (e) => {
      e.preventDefault();
      const email = e.target.email.value.trim(),
        b = $(".btn", e.target);
      b.disabled = true;
      try {
        await api("POST", "/auth/mot-de-passe-oublie", { email });
        step2(email);
      } catch (x) {
        showErr(x.message);
      } finally {
        b.disabled = false;
      }
    };
  };
  const step2 = (email) => {
    $("#fp").innerHTML =
      `<p class="mut">Si un compte existe pour <b>${esc(email)}</b>, un code vient d'être envoyé (pensez aux courriers indésirables).</p>
      <form id="f2" novalidate>${APP.formHtml([
        {
          k: "code",
          l: "Code reçu par e-mail",
          req: true,
          maxlength: 6,
          pattern: "[0-9]{6}",
          title: "6 chiffres",
          ac: "one-time-code",
        },
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
          l: "Confirmer le mot de passe",
          t: "password",
          req: true,
        },
      ])}${errBox}<button class="btn">Changer mon mot de passe</button></form>
      <p class="auth-alt"><a href="#/mot-de-passe-oublie" id="again">Renvoyer un code</a></p>`;
    $("#again").onclick = (e) => {
      e.preventDefault();
      step1();
    };
    $("#f2").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.nouveau.value !== f.confirm.value)
        return showErr("La confirmation ne correspond pas");
      const b = $(".btn", f);
      b.disabled = true;
      try {
        await api("POST", "/auth/reinitialiser-mot-de-passe", {
          email,
          code: f.code.value.trim(),
          nouveau: f.nouveau.value,
        });
        toast("Mot de passe modifié : vous pouvez vous connecter", "ok");
        location.hash = "#/";
      } catch (x) {
        showErr(x.message);
      } finally {
        b.disabled = false;
      }
    };
  };
  step1();
}

async function boot() {
  if (!S.token) return showPublic();
  $("#app").innerHTML =
    `<div class="shell"><div class="col" style="grid-column:1/-1;padding:32px">${APP.skeleton()}</div></div>`;
  try {
    S.stats = await api("GET", "/stats");
  } catch {
    return;
  }
  const items = APP.NAV.filter((n) => n.roles.includes(S.user.role)),
    groups = [...new Set(items.map((n) => n.group))],
    u = S.user;
  $("#app").innerHTML =
    `<div class="shell"><aside class="side" id="side" aria-label="Navigation principale"><div class="brand">${mark()}<div><b>${esc(u.school?.name || "Plateforme écoles")}</b><small>${u.school ? "Année " + esc(APP.year()) : "Administration de la plateforme"}</small></div></div>
    <nav>${groups
      .map(
        (g) =>
          `${g ? `<div class="sep">${esc(g)}</div>` : ""}${items
            .filter((n) => n.group === g)
            .map(
              (n) =>
                `<a href="#/${n.id}" data-nav="${n.id}">${icon(n.icon)}<span>${esc(n.label)}</span></a>`,
            )
            .join("")}`,
      )
      .join("")}</nav></aside><div class="scrim" id="scrim"></div>
    <div class="col"><header class="top"><button class="icon-btn only-mobile" id="burger" aria-label="Ouvrir le menu" aria-controls="side" aria-expanded="false">${icon("list", 24)}</button>
    <div class="ctx grow">${u.school ? `<b>${esc(u.school.name)}</b><span class="chip">${icon("calendar-blank", 14)} ${esc(APP.year())}</span>` : "<b>Administration de la plateforme</b>"}</div>
    ${themeBtn()}${u.role !== "superadmin" ? `<div class="menu-wrap"><button class="icon-btn" id="bell" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">${icon("bell")}<span class="n" id="bellN" hidden>0</span></button><div class="dd" id="dd" hidden></div></div>` : ""}
    <div class="menu-wrap"><button class="user-btn" id="ub" aria-haspopup="true" aria-expanded="false"><span class="av">${APP.initials(u.prenom, u.nom)}</span><span class="who"><b>${esc(u.prenom)} ${esc(u.nom)}</b><span>${ROLES[u.role]}</span></span>${icon("caret-down", 14)}</button>
    <div class="dd narrow" id="udd" hidden><div class="dd-h">${esc(u.prenom)} ${esc(u.nom)}<small class="mut" style="display:block;font-weight:400;font-family:var(--font-ui)">${esc(u.email)}</small></div><a class="it row-i" href="#/profil">${icon("user-circle")} Mon profil</a><div class="sepl"></div><button class="it row-i danger" id="out">${icon("sign-out")} Déconnexion</button></div></div></header>
    <main id="main" tabindex="-1"></main></div></div>`;
  const side = $("#side"),
    scrim = $("#scrim"),
    burger = $("#burger");
  const drawer = (open) => {
    side.classList.toggle("open", open);
    scrim.classList.toggle("show", open);
    burger.setAttribute("aria-expanded", open);
  };
  burger.onclick = () => drawer(!side.classList.contains("open"));
  scrim.onclick = () => drawer(false);
  side.onclick = (e) => {
    if (e.target.closest("a")) drawer(false);
  };
  const toggleMenu = (btn, dd) => {
    const open = dd.hidden;
    $$(".menu-wrap .dd").forEach((d) => (d.hidden = true));
    dd.hidden = !open;
    btn.setAttribute("aria-expanded", open);
    return open;
  };
  $("#ub").onclick = () => toggleMenu($("#ub"), $("#udd"));
  $("#out").onclick = logout;
  $("#udd").onclick = (e) => {
    if (e.target.closest("a")) $("#udd").hidden = true;
  };
  if ($("#bell")) {
    $("#bell").onclick = async () => {
      const dd = $("#dd");
      if (!toggleMenu($("#bell"), dd)) return;
      dd.innerHTML =
        '<div class="dd-h">Notifications</div><div class="sk sk-row" style="margin:12px"></div>';
      const d = await api("GET", "/notifications");
      APP.notifs = d.items;
      dd.innerHTML =
        '<div class="dd-h">Notifications</div>' +
        (d.items.length
          ? d.items
              .map(
                (i) =>
                  `<button class="it ${i.lu ? "" : "new"}" data-l="${esc(i.lien || "")}"><b>${esc(i.titre)}</b><small>${esc(i.texte || "")}</small><small>${APP.fdt(i.created_at)}</small></button>`,
              )
              .join("")
          : APP.empty("Aucune notification", "Vous êtes à jour.", "bell")) +
        ("Notification" in window && Notification.permission === "default"
          ? `<button class="it row-i" data-perm>${icon("bell")} Activer les notifications du navigateur</button>`
          : "");
      await api("POST", "/notifications/lues");
      $("#bellN").hidden = true;
      $("#bell").setAttribute("aria-label", "Notifications");
    };
    $("#dd").onclick = async (e) => {
      const it = e.target.closest(".it");
      if (!it) return;
      if (it.hasAttribute("data-perm")) {
        await Notification.requestPermission();
        return;
      }
      $("#dd").hidden = true;
      $("#bell").setAttribute("aria-expanded", "false");
      if (it.dataset.l) location.hash = it.dataset.l;
    };
    pollNotifs();
    notifTimer = setInterval(pollNotifs, 30000);
  }
  if (S.user.mdp_temporaire) history.replaceState(null, "", "#/profil"); // mot de passe temporaire : on invite à le changer
  window.onhashchange = route;
  route();
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("/sw.js").catch(() => {});
}
async function route() {
  const id = (location.hash.replace(/^#\/?/, "") || "accueil").split("?")[0];
  const nav =
    APP.NAV.find((n) => n.id === id && n.roles.includes(S.user.role)) ||
    APP.NAV.find((n) => n.id === "accueil");
  $$("[data-nav]").forEach((a) => {
    const on = a.dataset.nav === nav.id;
    on
      ? a.setAttribute("aria-current", "page")
      : a.removeAttribute("aria-current");
  });
  document.title = `${nav.label} — ${S.user.school?.name || "Plateforme"}`;
  $$(".overlay").forEach((o) => o.remove());
  document.body.classList.remove("noscroll"); // une fenêtre ouverte ne survit pas au changement de page
  const old = $("#main"),
    main = old.cloneNode(false);
  old.replaceWith(main); // nouvel élément : supprime les anciens écouteurs
  main.className = "rise";
  main.innerHTML = APP.skeleton();
  try {
    await APP.PAGES[nav.id](main);
    hydrateImages(main);
    main.focus({ preventScroll: true });
    window.scrollTo?.(0, 0);
  } catch (e) {
    main.innerHTML = `<div class="card">${APP.empty("Impossible de charger cette page", e.message, "warning-circle")}<div class="row" style="justify-content:center"><button class="btn sec" data-retry>${icon("arrow-counter-clockwise", 18)} Réessayer</button></div></div>`;
    const r = $("[data-retry]", main);
    if (r) r.onclick = () => APP.route();
  }
}
APP.route = route;
window.addEventListener("load", () => {
  if (APP.PAGES.accueil) boot();
});
window.addEventListener("hashchange", () => {
  if (S.token) $$(".overlay").forEach((o) => o.remove());
});
