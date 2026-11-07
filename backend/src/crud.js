// Fabrique CRUD générique : liste / détail / ajout / modification / suppression,
// contrôles de saisie, journalisation (anciennes/nouvelles valeurs), suppression logique et contrôlée.
const { audit, HttpError, SOFT } = require("./db");
const { auth, allow, h } = require("./auth");
const { check } = require("./validate");
const { numbered } = require("./access");

module.exports = function crud(router, name, c) {
  const t = c.table,
    soft = SOFT.has(t);
  const baseSql = (req) =>
    `SELECT ${c.cols || "x.*"} FROM ${t} x WHERE x.school_id=$1` +
    (soft ? " AND x.deleted_at IS NULL" : "");

  async function fetch(req, db, id, extraWhere = "", extraP = []) {
    id = Number(id);
    if (!Number.isInteger(id)) throw new HttpError(404, "Introuvable");
    const p = [db.sid, id];
    let sql = baseSql(req) + " AND x.id=$2";
    if (c.scope) {
      const s = await c.scope(req, db);
      if (s) {
        const [f, ps] = numbered(s, p.length);
        sql += " AND " + f;
        p.push(...ps);
      }
    }
    const row = await db.one(sql, p);
    if (!row) throw new HttpError(404, "Introuvable"); // autre école, ou pas le droit : même réponse
    return row;
  }
  c.fetch = fetch;

  router.get(
    "/" + name,
    auth,
    allow(...c.read),
    h(async (req, res, db) => {
      const p = [db.sid];
      let sql = baseSql(req);
      for (const f of c.filters || []) {
        const v = req.query[f];
        if (v !== undefined && v !== "") {
          p.push(String(v));
          sql += ` AND x.${f}=$${p.length}`;
        }
      }
      if (c.scope) {
        const s = await c.scope(req, db);
        if (s) {
          const [f, ps] = numbered(s, p.length);
          sql += " AND " + f;
          p.push(...ps);
        }
      }
      return db.q(sql + ` ORDER BY ${c.order || "x.id"} LIMIT 2000`, p);
    }),
  );

  router.get(
    "/" + name + "/:id",
    auth,
    allow(...c.read),
    h((req, res, db) => fetch(req, db, req.params.id)),
  );

  router.post(
    "/" + name,
    auth,
    allow(...(c.create || c.write)),
    h(async (req, res, db) => {
      if (c.guard) await c.guard(req, db, null);
      let data = await check(req.body || {}, c.schema, db);
      if (c.before) data = (await c.before(db, data, req, null)) || data;
      const row = await db.insert(t, data);
      await audit(
        db,
        req.user,
        "AJOUT",
        name,
        row.id,
        null,
        data.password_hash ? { ...data, password_hash: "***" } : data,
      );
      if (c.after) await c.after(db, row, req, true);
      res.status(201);
      const out = c.cols ? await fetch(req, db, row.id) : row;
      return req.extra ? { ...out, ...req.extra } : out;
    }),
  );

  router.put(
    "/" + name + "/:id",
    auth,
    allow(...(c.update || c.write)),
    h(async (req, res, db) => {
      const old = await fetch(req, db, req.params.id);
      if (c.guard) await c.guard(req, db, old);
      const merged = { ...old, ...req.body };
      let data = await check(merged, c.schema, db);
      if (c.before) data = (await c.before(db, data, req, old)) || data;
      for (const k of Object.keys(data))
        if (data[k] === undefined) delete data[k];
      const row = await db.update(t, old.id, data);
      const mask = (o) =>
        o && o.password_hash ? { ...o, password_hash: "***" } : o;
      const diffOld = {},
        diffNew = {};
      for (const k of Object.keys(data))
        if (String(old[k] ?? "") !== String(data[k] ?? "")) {
          diffOld[k] = old[k];
          diffNew[k] = data[k];
        }
      await audit(
        db,
        req.user,
        "MODIF",
        name,
        row.id,
        mask(diffOld),
        mask(diffNew),
      );
      if (c.after) await c.after(db, row, req, false, old);
      const out = c.cols ? await fetch(req, db, row.id) : row;
      return req.extra ? { ...out, ...req.extra } : out;
    }),
  );

  router.delete(
    "/" + name + "/:id",
    auth,
    allow(...(c.remove || c.write)),
    h(async (req, res, db) => {
      const old = await fetch(req, db, req.params.id);
      if (c.guard) await c.guard(req, db, old);
      for (const [tbl, col, label] of c.refs || []) {
        // suppression contrôlée
        const n = (
          await db.one(
            `SELECT count(*)::int AS n FROM ${tbl} WHERE ${col}=$1 AND school_id=$2` +
              (SOFT.has(tbl) ? " AND deleted_at IS NULL" : ""),
            [old.id, db.sid],
          )
        ).n;
        if (n > 0)
          throw new HttpError(
            409,
            `Suppression impossible : ${n} ${label} y sont rattaché(e)s. Réaffectez-les ou supprimez-les d'abord.`,
          );
      }
      if (c.beforeDelete) await c.beforeDelete(db, old, req);
      if (soft)
        await db.q(
          `UPDATE ${t} SET deleted_at=now() WHERE id=$1 AND school_id=$2`,
          [old.id, db.sid],
        );
      else await db.remove(t, old.id);
      await audit(
        db,
        req.user,
        "SUPPR",
        name,
        old.id,
        old.password_hash ? { ...old, password_hash: "***" } : old,
        null,
      );
      return { ok: true };
    }),
  );
};
