import jwt from "jsonwebtoken";
import { q } from "./db.js";

const SECRET = process.env.JWT_SECRET || "dev-only-secret-change-me";
if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  console.warn("[tutordesk] JWT_SECRET is not set – set it in your Vercel env vars!");
}

// `v` is the user's token_version: bumping it signs the user out everywhere.
export const sign = user => jwt.sign({ sub: user.id, v: user.token_version || 0 }, SECRET, { expiresIn: "30d" });

export async function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "unauthorized" });
  let payload;
  try { payload = jwt.verify(token, SECRET); } catch { return res.status(401).json({ error: "unauthorized" }); }
  try {
    // Also records "last active" (at most once every 10 minutes per user)
    const { rows } = await q(
      `UPDATE users SET last_seen_at = CASE WHEN last_seen_at IS NULL OR last_seen_at < now() - interval '10 minutes' THEN now() ELSE last_seen_at END
       WHERE id=$1 RETURNING token_version, disabled`, [payload.sub]);
    if (!rows[0] || rows[0].token_version !== (payload.v || 0)) return res.status(401).json({ error: "unauthorized" });
    if (rows[0].disabled) return res.status(403).json({ error: "account_disabled" });
  } catch (e) { return next(e); }
  req.userId = payload.sub;
  next();
}
