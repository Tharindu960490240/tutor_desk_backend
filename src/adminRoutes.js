// Admin panel API. Admins manage accounts, feedback and sign-ups.
// Deliberately NO access to tutors' students, payments or attendance – only counts.
import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { q } from "./db.js";
import { parse, uuid } from "./validate.js";
import { getSignup, setSignup, isAdminEmail } from "./admin.js";
import { emailEnabled } from "./mail.js";
import { sendResetEmail } from "./authRoutes.js";

const r = Router();

r.get("/overview", async (req, res) => {
  const [u, f, d, su] = await Promise.all([
    q(`SELECT count(*)::int AS total,
              count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new7,
              count(*) FILTER (WHERE last_seen_at > now() - interval '7 days')::int AS active7,
              count(*) FILTER (WHERE last_seen_at > now() - interval '1 day')::int AS active1,
              count(*) FILTER (WHERE disabled)::int AS suspended
       FROM users`),
    q(`SELECT count(*) FILTER (WHERE NOT resolved)::int AS open,
              count(*) FILTER (WHERE NOT resolved AND message LIKE '[automatic crash report]%')::int AS crashes
       FROM feedback`),
    q(`SELECT (SELECT count(*) FROM students)::int AS students, (SELECT count(*) FROM classes)::int AS classes,
              (SELECT count(*) FROM payments)::int AS payments, (SELECT count(*) FROM attendance)::int AS marks`),
    getSignup(),
  ]);
  const days = await q(`SELECT to_char(d, 'YYYY-MM-DD') AS day,
      (SELECT count(*) FROM users WHERE created_at::date = d)::int AS signups,
      (SELECT count(*) FROM users WHERE last_seen_at::date = d)::int AS active
    FROM generate_series(current_date - 13, current_date, interval '1 day') AS d ORDER BY d`);
  res.json({ users: u.rows[0], feedback: f.rows[0], data: d.rows[0], signup: su, emailEnabled, days: days.rows });
});

/* ---------- tutors ---------- */
r.get("/users", async (req, res) => {
  const { rows } = await q(`
    SELECT u.id, u.name, u.email, u.created_at, u.last_seen_at, u.disabled, u.settings->>'lang' AS lang,
      (SELECT count(*) FROM students s WHERE s.user_id=u.id)::int AS students,
      (SELECT count(*) FROM classes c WHERE c.user_id=u.id)::int AS classes,
      (SELECT count(*) FROM feedback f WHERE f.user_id=u.id)::int AS feedback,
      COALESCE((u.settings->>'sample')::boolean, false) AS sample
    FROM users u ORDER BY u.created_at DESC LIMIT 1000`);
  res.json(rows.map(x => ({ ...x, isAdmin: isAdminEmail(x.email), you: x.id === req.userId })));
});

async function target(req, res) {
  const id = parse(uuid, req.params.id, res); if (!id) return null;
  const { rows } = await q(`SELECT id, email, settings->>'lang' AS lang FROM users WHERE id=$1`, [id]);
  if (!rows[0]) { res.status(404).json({ error: "not_found" }); return null; }
  if (rows[0].id === req.userId) { res.status(400).json({ error: "not_yourself" }); return null; }
  return rows[0];
}

// Temporary password that meets the password rules, e.g. "Kp7@mx4Rqa"
function tempPassword() {
  const pick = s => s[crypto.randomInt(s.length)];
  const U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghijkmnpqrstuvwxyz", D = "23456789", S = "@$!%*?&";
  const chars = [pick(U), pick(L), pick(D), pick(S), ...Array.from({ length: 6 }, () => pick(U + L + D))];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

r.post("/users/:id/temp-password", async (req, res) => {
  const u = await target(req, res); if (!u) return;
  const pw = tempPassword();
  await q(`UPDATE users SET password_hash=$2, token_version=token_version+1 WHERE id=$1`, [u.id, await bcrypt.hash(pw, 10)]);
  res.json({ password: pw });
});

r.post("/users/:id/send-reset", async (req, res) => {
  if (!emailEnabled) return res.status(503).json({ error: "email_disabled" });
  const u = await target(req, res); if (!u) return;
  try { await sendResetEmail(u); } catch (e) { console.error("[mail]", e.message); return res.status(502).json({ error: "email_failed" }); }
  res.json({ ok: true });
});

r.put("/users/:id/disabled", async (req, res) => {
  const u = await target(req, res); if (!u) return;
  const b = parse(z.object({ disabled: z.boolean() }), req.body, res); if (!b) return;
  // suspending also signs them out everywhere
  await q(`UPDATE users SET disabled=$2, token_version = token_version + CASE WHEN $2 THEN 1 ELSE 0 END WHERE id=$1`, [u.id, b.disabled]);
  res.json({ ok: true });
});

r.delete("/users/:id", async (req, res) => {
  const u = await target(req, res); if (!u) return;
  await q(`DELETE FROM users WHERE id=$1`, [u.id]);
  res.json({ ok: true });
});

/* ---------- feedback inbox ---------- */
r.get("/feedback", async (req, res) => {
  const status = ["open", "resolved", "all"].includes(req.query.status) ? req.query.status : "open";
  const { rows } = await q(`
    SELECT f.id, f.message, f.page, f.user_agent, f.emailed, f.resolved, f.created_at, f.email,
           u.name AS user_name, u.id AS user_id
    FROM feedback f LEFT JOIN users u ON u.id=f.user_id
    ${status === "all" ? "" : `WHERE f.resolved = ${status === "resolved"}`}
    ORDER BY f.created_at DESC LIMIT 300`);
  res.json(rows.map(x => ({ ...x, crash: x.message.startsWith("[automatic crash report]") })));
});

r.put("/feedback/:id", async (req, res) => {
  const id = parse(uuid, req.params.id, res); if (!id) return;
  const b = parse(z.object({ resolved: z.boolean() }), req.body, res); if (!b) return;
  const u = await q(`UPDATE feedback SET resolved=$2 WHERE id=$1`, [id, b.resolved]);
  if (!u.rowCount) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

r.delete("/feedback/:id", async (req, res) => {
  const id = parse(uuid, req.params.id, res); if (!id) return;
  await q(`DELETE FROM feedback WHERE id=$1`, [id]);
  res.json({ ok: true });
});

/* ---------- sign-ups ---------- */
r.get("/signup", async (req, res) => res.json(await getSignup()));
r.put("/signup", async (req, res) => {
  const b = parse(z.object({ mode: z.enum(["invite", "open", "closed"]), code: z.string().trim().max(60).default("") }), req.body, res); if (!b) return;
  if (b.mode === "invite" && b.code.length < 4) return res.status(400).json({ error: "code_too_short" });
  const prev = await getSignup();
  const next = { mode: b.mode, code: b.code || prev.code || "" }; // keep the old code when switching to open/closed
  await setSignup(next);
  res.json(next);
});

export default r;
