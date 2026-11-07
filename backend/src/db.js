// Accès base de données. TOUT passe par tx() : chaque requête s'exécute dans une
// transaction où l'école est fixée (app.school_id) -> filtre WHERE + Row Level Security.
const { Pool, types } = require('pg');
types.setTypeParser(1082, v => v);              // DATE -> 'YYYY-MM-DD'
types.setTypeParser(1700, v => parseFloat(v));  // NUMERIC -> number
types.setTypeParser(20, v => parseInt(v, 10));  // BIGINT -> number

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const SOFT = new Set(['classes', 'matieres', 'salles', 'eleves', 'paiements', 'evaluations', 'devoirs']);
const ident = n => { if (!/^[a-z_]+$/.test(n)) throw new Error('identifiant invalide'); return n; };

function mkdb(client, sid) {
  const q = async (sql, p = []) => (await client.query(sql, p)).rows;
  const db = {
    sid, q,
    one: async (sql, p) => (await q(sql, p))[0],
    // --- Filtre école appliqué en UN SEUL endroit : ces helpers ---
    find: (t, id) => db.one(`SELECT * FROM ${ident(t)} WHERE id=$1 AND school_id=$2` + (SOFT.has(t) ? ' AND deleted_at IS NULL' : ''), [id, sid]),
    insert: async (t, data) => {
      const d = { ...data, school_id: sid }, ks = Object.keys(d);
      return db.one(`INSERT INTO ${ident(t)} (${ks.map(ident).join(',')}) VALUES (${ks.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, ks.map(k => d[k]));
    },
    update: async (t, id, data) => {
      const ks = Object.keys(data);
      return db.one(`UPDATE ${ident(t)} SET ${ks.map((k, i) => ident(k) + '=$' + (i + 3)).join(',')} WHERE id=$1 AND school_id=$2 RETURNING *`, [id, sid, ...ks.map(k => data[k])]);
    },
    remove: (t, id) => q(`DELETE FROM ${ident(t)} WHERE id=$1 AND school_id=$2`, [id, sid]),
  };
  return db;
}

// ctx = { schoolId } (utilisateur d'école) | { bypass:true, schoolId? } (superadmin, connexion, tâches système)
async function tx(ctx, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (ctx.bypass) await client.query("SELECT set_config('app.bypass','on',true)");
    await client.query("SELECT set_config('app.school_id',$1,true)", [String(ctx.schoolId ?? '')]);
    const r = await fn(mkdb(client, ctx.schoolId ?? null));
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

async function audit(db, user, action, entite, entiteId, anciennes, nouvelles) {
  await db.q('INSERT INTO journal (school_id,user_id,action,entite,entite_id,anciennes,nouvelles) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [db.sid, user?.id ?? null, action, entite, entiteId ?? null, anciennes ? JSON.stringify(anciennes) : null, nouvelles ? JSON.stringify(nouvelles) : null]);
}

module.exports = { pool, tx, mkdb, audit, HttpError, SOFT };
