const express = require("express");
const crypto = require("crypto");
const { tx, HttpError } = require("../db");
const { bcrypt } = require("../auth");
const { checkPassword } = require("../validate");
const { sendMailRaw } = require("../notify");
const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Étape 1 : demande du code (réponse identique que le compte existe ou non)
router.post("/auth/mot-de-passe-oublie", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    if (EMAIL_RE.test(email) && !email.endsWith("@eleve.local")) {
      await tx({ bypass: true }, async (db) => {
        const u = await db.one(
          "SELECT 1 AS x FROM users WHERE lower(email)=$1 AND actif LIMIT 1",
          [email],
        );
        if (!u) return;
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
        await db.q("DELETE FROM password_resets WHERE email=$1", [email]);
        await db.q(
          `INSERT INTO password_resets (email, code_hash, expires_at) VALUES ($1,$2, now() + interval '15 minutes')`,
          [email, await bcrypt.hash(code, 10)],
        );
        await sendMailRaw(
          email,
          "Réinitialisation de votre mot de passe",
          `Votre code de vérification : ${code}\n\nIl est valable 15 minutes.\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
        );
      });
    }
    res.json({
      ok: true,
      message:
        "Si cette adresse correspond à un compte, un code de vérification vient d'être envoyé.",
    });
  } catch (e) {
    next(e);
  }
});

// Étape 2 : code + nouveau mot de passe
router.post("/auth/reinitialiser-mot-de-passe", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const code = String(req.body?.code || "").trim();
    const hash = await bcrypt.hash(checkPassword(req.body?.nouveau), 10);
    // le statut est renvoyé (et non une exception) pour que le compteur d'essais ne soit pas annulé par le ROLLBACK
    const statut = await tx({ bypass: true }, async (db) => {
      const r = await db.one(
        "SELECT id, code_hash, attempts FROM password_resets WHERE email=$1 AND expires_at > now()",
        [email],
      );
      if (!r || r.attempts >= 5) return "expire";
      if (!(await bcrypt.compare(code, r.code_hash))) {
        await db.q(
          "UPDATE password_resets SET attempts=attempts+1 WHERE id=$1",
          [r.id],
        );
        return "faux";
      }
      // même e-mail dans plusieurs écoles : le mot de passe est mis à jour pour tous les comptes de cette adresse
      await db.q(
        "UPDATE users SET password_hash=$2, mdp_temporaire=false WHERE lower(email)=$1 AND actif",
        [email, hash],
      );
      await db.q("DELETE FROM password_resets WHERE email=$1", [email]);
      return "ok";
    });
    if (statut === "expire")
      throw new HttpError(
        400,
        "Code expiré ou trop d'essais : refaites une demande.",
      );
    if (statut === "faux") throw new HttpError(400, "Code incorrect.");
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
