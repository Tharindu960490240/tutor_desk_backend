import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { q } from "./db.js";
import { parse } from "./validate.js";
import { emailEnabled, sendMail, layout, appUrl } from "./mail.js";

const r = Router();
const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });

// Saved to the database first (so nothing is lost), then emailed to you.
r.post("/", limiter, async (req, res) => {
  const b = parse(z.object({ message: z.string().trim().min(1).max(5000), page: z.string().max(200).default("") }), req.body, res);
  if (!b) return;
  const u = (await q(`SELECT email, name FROM users WHERE id=$1`, [req.userId])).rows[0] || {};
  const ua = String(req.headers["user-agent"] || "").slice(0, 300);
  const { rows } = await q(`INSERT INTO feedback (user_id, email, message, page, user_agent) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [req.userId, u.email || "", b.message, b.page, ua]);
  const to = process.env.FEEDBACK_EMAIL || process.env.GMAIL_USER;
  if (emailEnabled && to) {
    try {
      await sendMail({
        to, replyTo: u.email,
        subject: `TutorDesk feedback from ${u.name || u.email}`,
        text: `${b.message}\n\n— ${u.name} <${u.email}>\nPage: ${b.page}\nDevice: ${ua}`,
        html: layout({
          lang: "en", heading: "New feedback", preheader: b.message, quote: b.message,
          details: [["From", `${u.name || ""} <${u.email || ""}>`], ["Page", b.page || "–"], ["Device", ua || "–"]],
          button: "Open the admin panel", link: `${appUrl()}/admin`, footer: "Reply to this email to answer the tutor directly.",
        }),
      });
      await q(`UPDATE feedback SET emailed=true WHERE id=$1`, [rows[0].id]);
    } catch (e) { console.error("[mail] feedback email failed:", e.message); }
  }
  res.status(201).json({ ok: true });
});

export default r;
