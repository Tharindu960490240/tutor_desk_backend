import { q } from "./db.js";

/** Admins are the emails listed in ADMIN_EMAILS (comma-separated). */
const ADMINS = (process.env.ADMIN_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
export const isAdminEmail = email => !!email && ADMINS.includes(String(email).toLowerCase());

export async function requireAdmin(req, res, next) {
  try {
    const { rows } = await q(`SELECT email FROM users WHERE id=$1`, [req.userId]);
    if (!rows[0] || !isAdminEmail(rows[0].email)) return res.status(403).json({ error: "forbidden" });
    next();
  } catch (e) { next(e); }
}

/* ---------- sign-up settings (invite code), editable from the admin panel ----------
   mode: "invite" (code required) | "open" (anyone) | "closed" (no new sign-ups)
   Falls back to the SIGNUP_CODE env var until the admin saves something. */
let cache = null, cacheAt = 0;
export async function getSignup() {
  if (cache && Date.now() - cacheAt < 30_000) return cache;
  const { rows } = await q(`SELECT value FROM app_settings WHERE key='signup'`);
  const env = (process.env.SIGNUP_CODE || "").trim();
  cache = rows[0]?.value || { mode: env ? "invite" : "open", code: env };
  cacheAt = Date.now();
  return cache;
}
export async function setSignup(value) {
  await q(`INSERT INTO app_settings (key, value, updated_at) VALUES ('signup', $1, now())
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [value]);
  cache = value; cacheAt = Date.now();
}
