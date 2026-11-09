import pg from "pg";
import SCHEMA from "./schema.js";

// Return DATE columns as plain "YYYY-MM-DD" strings and NUMERIC as numbers.
pg.types.setTypeParser(1082, v => v);
pg.types.setTypeParser(1700, v => (v == null ? null : parseFloat(v)));

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) console.warn("[tutordesk] DATABASE_URL is not set");
const local = !url || /localhost|127\.0\.0\.1|\/var\/run|host=\//.test(url);

export const pool = new pg.Pool({
  connectionString: url,
  ssl: local ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 5),
  idleTimeoutMillis: 10_000,
});

export const q = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

let ready;
/** Create tables once per process (cold start). Idempotent. */
export function ensureSchema() {
  if (!ready) {
    ready = pool.query(SCHEMA).catch(e => { ready = null; throw e; });
  }
  return ready;
}
