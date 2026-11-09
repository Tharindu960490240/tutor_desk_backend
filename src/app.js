import express from "express";
import cors from "cors";
import helmet from "helmet";
import { ensureSchema, pool } from "./db.js";
import { requireAuth } from "./auth.js";
import authRoutes from "./authRoutes.js";
import coreRoutes from "./coreRoutes.js";
import dataRoutes from "./dataRoutes.js";
import feedbackRoutes from "./feedbackRoutes.js";
import adminRoutes from "./adminRoutes.js";
import { requireAdmin } from "./admin.js";

const app = express();
app.set("trust proxy", 1);
app.use(helmet());

// FRONTEND_URL: comma-separated list of allowed origins. "*" wildcards allowed,
// e.g. "https://tutordesk.vercel.app,https://tutordesk-*.vercel.app". Empty = allow all.
const allowed = (process.env.FRONTEND_URL || "").split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean)
  .map(p => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]+") + "$"));
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || !allowed.length || allowed.some(r => r.test(origin))),
  maxAge: 86400,
}));
app.use(express.json({ limit: "10mb" }));

// Health / self-check. Shows what is set up, never the secret values themselves.
app.get(["/", "/api", "/api/health"], async (req, res) => {
  const out = {
    ok: true,
    app: "TutorDesk API",
    config: {
      DATABASE_URL: !!(process.env.DATABASE_URL || process.env.POSTGRES_URL),
      JWT_SECRET: !!process.env.JWT_SECRET,
      FRONTEND_URL: !!process.env.FRONTEND_URL,
      ADMIN_EMAILS: !!process.env.ADMIN_EMAILS,
      GMAIL: !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
    },
  };
  try {
    await Promise.race([pool.query("SELECT 1"), new Promise((_, rej) => setTimeout(() => rej(new Error("timed out after 8s")), 8000))]);
    out.database = "connected";
  } catch (e) {
    out.ok = false;
    out.database = "error: " + (e.message || String(e)).replace(/postgres(ql)?:\/\/[^\s]+/g, "[hidden]");
  }
  res.status(out.ok ? 200 : 503).json(out);
});
app.use("/api", async (req, res, next) => { try { await ensureSchema(); next(); } catch (e) { next(e); } });
app.use("/api/auth", authRoutes);
app.use("/api/data", requireAuth, dataRoutes);
app.use("/api/feedback", requireAuth, feedbackRoutes);
app.use("/api/admin", requireAuth, requireAdmin, adminRoutes);
app.use("/api", requireAuth, coreRoutes);

app.use((req, res) => res.status(404).json({ error: "not_found" }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "invalid_json" });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "too_large" });
  console.error(err);
  res.status(500).json({ error: "server_error" });
});

export default app;
