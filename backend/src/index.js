const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { login } = require("./auth");
const { tx, pool } = require("./db");
const path = require("path");

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));

app.post(
  "/api/auth/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: +process.env.LOGIN_RATE_LIMIT || 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Trop de tentatives, réessayez dans quelques minutes" },
  }),
  async (req, res, next) => {
    try {
      res.json(
        await login(req.body?.email, req.body?.password, req.body?.school_id),
      );
    } catch (e) {
      next(e);
    }
  },
);

// Formulaire public de pré-inscription : limité par adresse IP (anti-spam)
const resetLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives, réessayez dans quelques minutes" },
});
app.use("/api/auth/mot-de-passe-oublie", resetLimit);
app.use("/api/auth/reinitialiser-mot-de-passe", resetLimit);
app.use("/api", require("./routes/motdepasse"));
app.use(
  "/api/public/preinscriptions",
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: +process.env.PUBLIC_RATE_LIMIT || 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Trop de demandes depuis cette adresse, réessayez plus tard",
    },
  }),
);
app.use("/api", require("./routes/preinscriptions"));
app.use("/api", require("./routes/misc"));
app.use("/api", require("./routes/core"));
app.use("/api", require("./routes/pedago"));
app.use("/api", require("./routes/finance"));
app.use("/api", require("./routes/bi"));
app.use("/api", require("./routes/devoirs"));
app.use("/api", require("./routes/messages"));
app.use("/api", require("./files").router);
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Route introuvable" }),
);
// Interface web : l'API sert aussi les fichiers du frontend (hébergement en un seul service)
app.use(
  express.static(path.join(__dirname, "..", "public"), {
    setHeaders: (res, file) => {
      if (/(\.html|sw\.js)$/.test(file))
        res.setHeader("Cache-Control", "no-cache");
    },
  }),
);

app.use((err, req, res, next) => {
  if (res.headersSent) return;
  let status = err.status || 500,
    msg = err.message;
  if (err.type === "entity.parse.failed") {
    status = 400;
    msg = "Requête JSON invalide";
  } else if (err.code === "LIMIT_FILE_SIZE") {
    status = 400;
    msg = "Fichier trop volumineux (5 Mo maximum)";
  } else if (err.name === "MulterError") {
    status = 400;
    msg = "Téléversement invalide (5 fichiers maximum)";
  } else if (err.code === "23505") {
    status = 409;
    msg =
      "Doublon : un enregistrement identique existe déjà (matricule, e-mail, nom, créneau…)";
  } else if (err.code === "23503") {
    status = 409;
    msg =
      "Opération impossible : cet élément est utilisé ailleurs (désactivez-le plutôt que de le supprimer)";
  } else if (
    ["22P02", "22007", "22008", "22003", "23514", "23502", "22001"].includes(
      err.code,
    )
  ) {
    status = 400;
    msg = "Valeur invalide ou hors limites";
  } else if (!err.status) {
    console.error(err);
    msg = "Erreur interne du serveur";
  }
  res.status(status).json({ error: msg });
});

async function main() {
  for (let i = 0; i < 30; i++) {
    // attend la base
    try {
      await pool.query("SELECT 1");
      break;
    } catch {
      if (i === 29) throw new Error("Base de données injoignable");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await require("./seed").seedIfEmpty();
  const port = +process.env.PORT || 4000;
  app.listen(port, () => console.log(`API prête sur le port ${port}`));
  console.log(
    "E-mail :",
    process.env.BREVO_API_KEY
      ? "API Brevo"
      : process.env.SMTP_HOST
        ? `SMTP ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}`
        : "NON CONFIGURÉ",
  );
  if (process.env.RELANCES_AUTO !== "false") {
    // relances automatiques (tâche de fond : l'école est passée explicitement)
    const run = async () => {
      try {
        const schools = await tx({ bypass: true }, (db) =>
          db.q(
            `SELECT id,annee_courante FROM schools WHERE status<>'suspended'`,
          ),
        );
        for (const s of schools)
          await tx({ bypass: true, schoolId: s.id }, async (db) => {
            const admin = await db.one(
              `SELECT id FROM users WHERE school_id=$1 AND role='admin' AND actif ORDER BY id LIMIT 1`,
              [s.id],
            );
            if (admin)
              await require("./routes/finance").relancer(
                db,
                admin.id,
                s.annee_courante,
                true,
              );
          });
      } catch (e) {
        console.error("relances auto :", e.message);
      }
    };
    setTimeout(run, 60_000);
    setInterval(run, 24 * 3600 * 1000);
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
module.exports = app;
