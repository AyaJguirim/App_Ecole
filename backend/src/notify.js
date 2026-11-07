// Notifications : in-app (+ push navigateur côté front), e-mail (SendGrid si SENDGRID_API_KEY), journal d'envoi.
// Retourne 'envoye' | 'non_configure' | 'echec_xxx' et journalise dans envois_log.
const nodemailer = require("nodemailer");
let transporter; // créé une seule fois, au premier envoi
function getTransporter() {
  if (transporter !== undefined) return transporter;
  if (!process.env.SMTP_HOST) return (transporter = null); // SMTP non configuré
  return (transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: +process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === "true", // true pour le port 465, false pour 587
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000,
  }));
}

// Envoi brut (sans journal) : 'envoye' | 'non_configure' | 'echec_smtp'
async function sendMailRaw(to, sujet, texte) {
  const t = getTransporter();
  if (!t) return "non_configure";
  try {
    await t.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      subject: sujet,
      text: texte || sujet,
    });
    return "envoye";
  } catch (e) {
    console.error("Envoi e-mail impossible :", e.message);
    return "echec_smtp";
  }
}

async function sendEmail(db, userId, to, sujet, texte, schoolId = db.sid) {
  const statut = await sendMailRaw(to, sujet, texte);
  if (schoolId)
    await db.q(
      "INSERT INTO envois_log (school_id,destinataire_id,canal,sujet,statut) VALUES ($1,$2,$3,$4,$5)",
      [schoolId, userId || null, "email", sujet.slice(0, 150), statut],
    );
  return statut;
}

async function notify(db, userIds, titre, texte, lien) {
  const ids = [...new Set(userIds.filter(Boolean))];
  for (const id of ids) {
    const u = await db.one(
      "SELECT id,email,actif FROM users WHERE id=$1 AND school_id=$2",
      [id, db.sid],
    );
    if (!u || !u.actif) continue;
    await db.q(
      "INSERT INTO notifications (school_id,user_id,titre,texte,lien) VALUES ($1,$2,$3,$4,$5)",
      [
        db.sid,
        id,
        titre.slice(0, 150),
        (texte || "").slice(0, 500),
        lien || null,
      ],
    );
    await db.q(
      "INSERT INTO envois_log (school_id,destinataire_id,canal,sujet,statut) VALUES ($1,$2,$3,$4,$5)",
      [db.sid, id, "push", titre.slice(0, 150), "envoye"],
    );
    if (
      process.env.MAIL_NOTIFICATIONS === "true" &&
      !/@eleve\.local$/.test(u.email)
    )
      await sendEmail(db, id, u.email, titre, texte); // les comptes élèves n'ont pas de boîte e-mail
  }
}

// Envoie un message système (messagerie interne) + notification.
async function sendSystemMessage(
  db,
  fromId,
  toIds,
  objet,
  corps,
  { eleveId = null, lien = null } = {},
) {
  const m = await db.insert("messages", {
    expediteur_id: fromId,
    type: "message",
    objet: objet.slice(0, 150),
    corps,
    statut: "envoye",
    eleve_id: eleveId,
    lien,
    sent_at: new Date(),
  });
  for (const t of new Set(toIds.filter(Boolean)))
    await db.q(
      "INSERT INTO message_destinataires (school_id,message_id,destinataire_id) VALUES ($1,$2,$3)",
      [db.sid, m.id, t],
    );
  await notify(db, toIds, objet, corps.slice(0, 200), "#/messages");
  return m;
}
module.exports = { notify, sendEmail, sendSystemMessage };
module.exports = { notify, sendEmail, sendMailRaw, sendSystemMessage };
