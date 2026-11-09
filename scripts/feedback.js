// Show the latest feedback from testers:  npm run feedback
import { pool, ensureSchema } from "../src/db.js";
await ensureSchema();
const { rows } = await pool.query(`SELECT created_at, email, page, message FROM feedback ORDER BY created_at DESC LIMIT 50`);
for (const f of rows) console.log(`\n[${f.created_at.toISOString().slice(0, 16).replace("T", " ")}] ${f.email} (${f.page})\n${f.message}`);
if (!rows.length) console.log("No feedback yet.");
await pool.end();
