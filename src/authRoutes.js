import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { q, tx } from "./db.js";
import { sign, requireAuth } from "./auth.js";
import { parse, LANGS } from "./validate.js";
import { emailEnabled, sendMail, layout, mt, appUrl } from "./mail.js";
import { getSignup } from "./admin.js";

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
const forgotLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false });
const resetLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false });

const email = z.string().trim().toLowerCase().email().max(200);
// Same rule as the web app (and the AFC portal): 8+ chars, upper, lower, number, one of @$!%*?&
const password = z.string().max(200)
  .refine(v => v.length >= 8 && /[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v) && /[@$!%*?&]/.test(v), { message: "weak_password" });
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const contactEmail = () => process.env.FEEDBACK_EMAIL || process.env.GMAIL_USER || "";

// Public: tells the sign-in screen what to show
r.get("/config", async (req, res) => {
  const su = await getSignup();
  res.json({ inviteRequired: su.mode === "invite", signupsClosed: su.mode === "closed", emailEnabled, contactEmail: contactEmail() });
});

r.post("/register", limiter, async (req, res) => {
  const b = parse(z.object({
    name: z.string().trim().min(1).max(120), email, password,
    lang: z.enum(LANGS).default("en"),
    invite: z.string().trim().max(100).optional(),
    acceptTerms: z.literal(true),
  }), req.body, res);
  if (!b) return;
  const su = await getSignup();
  if (su.mode === "closed") return res.status(403).json({ error: "signups_closed" });
  if (su.mode === "invite" && (b.invite || "").trim().toLowerCase() !== String(su.code || "").trim().toLowerCase()) return res.status(403).json({ error: "bad_invite" });
  const exists = await q(`SELECT 1 FROM users WHERE lower(email)=$1`, [b.email]);
  if (exists.rowCount) return res.status(409).json({ error: "email_taken" });
  const hash = await bcrypt.hash(b.password, 10);
  const { rows } = await q(
    `INSERT INTO users (email, password_hash, name, settings, terms_accepted_at, last_seen_at) VALUES ($1,$2,$3,$4, now(), now())
     RETURNING id, email, name, token_version`,
    [b.email, hash, b.name, { tutorName: b.name, lang: b.lang }]);
  const u = rows[0];
  res.status(201).json({ token: sign(u), user: { id: u.id, email: u.email, name: u.name } });
});

r.post("/login", limiter, async (req, res) => {
  const b = parse(z.object({ email, password: z.string().min(1).max(200) }), req.body, res);
  if (!b) return;
  const { rows } = await q(`SELECT id, email, name, password_hash, token_version, disabled FROM users WHERE lower(email)=$1`, [b.email]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(b.password, u.password_hash))) return res.status(401).json({ error: "bad_login" });
  if (u.disabled) return res.status(403).json({ error: "account_disabled" });
  await q(`UPDATE users SET last_seen_at=now() WHERE id=$1`, [u.id]);
  res.json({ token: sign(u), user: { id: u.id, email: u.email, name: u.name } });
});

r.get("/me", requireAuth, async (req, res) => {
  const { rows } = await q(`SELECT id, email, name FROM users WHERE id=$1`, [req.userId]);
  if (!rows[0]) return res.status(401).json({ error: "unauthorized" });
  res.json({ user: rows[0] });
});

async function notifyChanged(userId) {
  if (!emailEnabled) return;
  const { rows } = await q(`SELECT email, settings->>'lang' AS lang FROM users WHERE id=$1`, [userId]);
  if (!rows[0]) return;
  const lg = rows[0].lang;
  await sendMail({
    to: rows[0].email, subject: mt(lg, "changed_subject"), text: mt(lg, "changed_body"),
    html: layout({ lang: lg, heading: mt(lg, "changed_subject"), body: mt(lg, "changed_body"), button: mt(lg, "changed_button"), link: appUrl() }),
  }).catch(e => console.error("[mail] changed notice failed:", e.message));
}

// Change password while signed in. Signs out every other device; returns a fresh token for this one.
r.put("/password", requireAuth, limiter, async (req, res) => {
  const b = parse(z.object({ current: z.string().min(1), next: password }), req.body, res);
  if (!b) return;
  const { rows } = await q(`SELECT password_hash FROM users WHERE id=$1`, [req.userId]);
  if (!rows[0] || !(await bcrypt.compare(b.current, rows[0].password_hash))) return res.status(400).json({ error: "bad_password" });
  const u = (await q(`UPDATE users SET password_hash=$2, token_version=token_version+1 WHERE id=$1 RETURNING id, token_version`,
    [req.userId, await bcrypt.hash(b.next, 10)])).rows[0];
  await notifyChanged(req.userId);
  res.json({ ok: true, token: sign(u) });
});

/** Create a single-use, 1-hour reset link and email it in the user's language. u = {id, email, lang} */
export async function sendResetEmail(u) {
  const token = crypto.randomBytes(32).toString("base64url");
  await q(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1,$2, now() + interval '1 hour')`, [sha(token), u.id]);
  const link = `${appUrl()}/reset-password?token=${token}`;
  const lg = u.lang;
  await sendMail({
    to: u.email, subject: mt(lg, "reset_subject"),
    text: `${mt(lg, "reset_body")}\n\n${link}\n\n${mt(lg, "reset_footer")}`,
    html: layout({ lang: lg, heading: mt(lg, "reset_heading"), body: mt(lg, "reset_body"), button: mt(lg, "reset_button"), link, footer: mt(lg, "reset_footer") }),
  });
}

// Forgot password: always answers the same way so nobody can probe which emails have accounts.
r.post("/forgot", forgotLimit, async (req, res) => {
  const b = parse(z.object({ email }), req.body, res);
  if (!b) return;
  if (!emailEnabled) return res.status(503).json({ error: "email_disabled" });
  const { rows } = await q(`SELECT id, email, settings->>'lang' AS lang FROM users WHERE lower(email)=$1`, [b.email]);
  const u = rows[0];
  if (u) {
    const recent = await q(`SELECT count(*)::int AS n FROM password_resets WHERE user_id=$1 AND created_at > now() - interval '1 hour'`, [u.id]);
    if (recent.rows[0].n < 3) {
      try { await sendResetEmail(u); }
      catch (e) {
        console.error("[mail] reset email failed:", e.message);
        return res.status(502).json({ error: "email_failed" });
      }
    }
  }
  res.json({ ok: true });
});

r.post("/reset", resetLimit, async (req, res) => {
  const b = parse(z.object({ token: z.string().min(20).max(200), password }), req.body, res);
  if (!b) return;
  const out = await tx(async c => {
    const { rows } = await c.query(`SELECT user_id FROM password_resets WHERE token_hash=$1 AND expires_at > now()`, [sha(b.token)]);
    if (!rows[0]) return null;
    const uid = rows[0].user_id;
    await c.query(`DELETE FROM password_resets WHERE user_id=$1`, [uid]);
    const u = (await c.query(`UPDATE users SET password_hash=$2, token_version=token_version+1 WHERE id=$1 RETURNING id, email, name, token_version`,
      [uid, await bcrypt.hash(b.password, 10)])).rows[0];
    return u;
  });
  if (!out) return res.status(400).json({ error: "bad_token" });
  await notifyChanged(out.id);
  res.json({ token: sign(out), user: { id: out.id, email: out.email, name: out.name } });
});

r.delete("/account", requireAuth, async (req, res) => {
  await q(`DELETE FROM users WHERE id=$1`, [req.userId]);
  res.json({ ok: true });
});

export default r;
