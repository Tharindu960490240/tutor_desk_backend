import { ensureSchema, pool } from "../src/db.js";
await ensureSchema();
console.log("Database schema is up to date.");
await pool.end();
