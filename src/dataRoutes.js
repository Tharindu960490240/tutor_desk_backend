import { Router } from "express";
import { q, tx } from "./db.js";
import { loadAll, mapAtt, DEFAULT_SETTINGS } from "./data.js";

const r = Router();
const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isYm = s => typeof s === "string" && /^\d{4}-\d{2}$/.test(s);
const isTime = s => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const str = (v, max = 200) => String(v ?? "").slice(0, max);
const num = v => (Number.isFinite(+v) && +v >= 0 ? +v : 0);
const LANGS = ["en", "si", "ta"];
const METHODS = ["cash", "bank", "mobile", "card", "other"];

/** Convert a backup from the old single-file TutorDesk (version 2) to the new format. */
function fromV2(data) {
  const core = data.docs.core;
  const classes = (core.classes || []).map(c => ({
    ...c, sessions: (c.days || []).map(d => ({ day: d, time: c.time || "16:00", duration: c.duration || 60 })),
  }));
  const ctime = Object.fromEntries(classes.map(c => [c.id, (c.time || "16:00")]));
  const payments = [], attendance = [];
  for (const [k, v] of Object.entries(data.docs)) {
    if (/^pay-\d{4}$/.test(k)) payments.push(...(v.items || []));
    if (/^att-\d{4}-\d{2}$/.test(k)) {
      for (const [key, rec] of Object.entries(v.records || {})) {
        const [cid, date] = key.split("|");
        for (const [sid, val] of Object.entries(rec)) attendance.push({ cid, date, time: ctime[cid] || "16:00", sid, v: val });
      }
    }
  }
  return { settings: core.settings, classes, students: core.students || [], payments, attendance };
}

export function normalizeBackup(data) {
  if (data && data.docs && data.docs.core && Array.isArray(data.docs.core.students)) return fromV2(data);
  if (data && Array.isArray(data.students) && Array.isArray(data.classes)) return data;
  return null;
}

async function wipe(c, uid) {
  await c.query(`DELETE FROM payments WHERE user_id=$1`, [uid]);
  await c.query(`DELETE FROM reminder_log WHERE user_id=$1`, [uid]);
  await c.query(`DELETE FROM classes WHERE user_id=$1`, [uid]);   // cascades sessions, attendance, links
  await c.query(`DELETE FROM students WHERE user_id=$1`, [uid]);
}

/** Replace a user's data with the contents of a (normalized) backup. Old ids are remapped. */
async function importInto(c, uid, b, settingsPatch) {
  await wipe(c, uid);
  const cmap = {}, smap = {};
  for (const k of b.classes || []) {
    const { rows } = await c.query(
      `INSERT INTO classes (user_id, name, subject, level, location, fee, admission_fee, color, ends_on) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [uid, str(k.name, 120) || "Class", str(k.subject), str(k.level), str(k.location), num(k.fee), num(k.admissionFee),
        /^#[0-9a-f]{6}$/i.test(k.color) ? k.color : "#0288d1", isDate(k.endsOn) ? k.endsOn : null]);
    cmap[k.id] = rows[0].id;
    const ses = (k.sessions || []).filter(s => Number.isInteger(+s.day) && +s.day >= 0 && +s.day <= 6 && isTime(s.time));
    if (ses.length) {
      await c.query(`INSERT INTO class_sessions (class_id, weekday, start_time, duration_min, valid_from, valid_until)
        SELECT $1, * FROM unnest($2::smallint[], $3::text[], $4::int[], $5::date[], $6::date[])`,
        [rows[0].id, ses.map(s => +s.day), ses.map(s => s.time), ses.map(s => Math.round(num(s.duration))),
          ses.map(s => (isDate(s.validFrom) ? s.validFrom : null)), ses.map(s => (isDate(s.validUntil) ? s.validUntil : null))]);
    }
  }
  for (const s of b.students || []) {
    const { rows } = await c.query(
      `INSERT INTO students (user_id, name, parent, parent_phone, phone, fee, joined, notes, active, ended_ym, lang)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [uid, str(s.name, 120) || "Student", str(s.parent), str(s.parentPhone, 40), str(s.phone, 40), num(s.fee),
        isDate(s.joined) ? s.joined : new Date().toISOString().slice(0, 10), str(s.notes, 2000), s.active !== false,
        isYm(s.endedYm) ? s.endedYm : null, LANGS.includes(s.lang) ? s.lang : "en"]);
    smap[s.id] = rows[0].id;
    for (const cid of (s.classIds || []).filter(id => cmap[id])) {
      await c.query(`INSERT INTO student_classes (student_id, class_id, admission_waived) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [rows[0].id, cmap[cid], (s.admissionWaived || []).includes(cid)]);
    }
  }
  const pays = (b.payments || []).filter(p => smap[p.sid] && isYm(p.ym) && num(p.amount) > 0 && (p.kind !== "admission" || cmap[p.cid]));
  if (pays.length) {
    await c.query(`INSERT INTO payments (user_id, student_id, kind, class_id, ym, amount, paid_on, method, note)
      SELECT $1, * FROM unnest($2::uuid[], $3::text[], $4::uuid[], $5::text[], $6::numeric[], $7::date[], $8::text[], $9::text[])`,
      [uid, pays.map(p => smap[p.sid]), pays.map(p => (p.kind === "admission" ? "admission" : "monthly")), pays.map(p => (p.kind === "admission" ? cmap[p.cid] : null)),
        pays.map(p => p.ym), pays.map(p => num(p.amount)),
        pays.map(p => (isDate(p.date) ? p.date : `${p.ym}-01`)), pays.map(p => (METHODS.includes(p.method) ? p.method : "other")), pays.map(p => str(p.note, 300))]);
  }
  const att = (b.attendance || []).filter(a => cmap[a.cid] && smap[a.sid] && isDate(a.date) && isTime(a.time) && ["P", "L", "A"].includes(a.v));
  if (att.length) {
    await c.query(`INSERT INTO attendance (user_id, class_id, date, start_time, student_id, status)
      SELECT $1, * FROM unnest($2::uuid[], $3::date[], $4::text[], $5::uuid[], $6::text[]) ON CONFLICT DO NOTHING`,
      [uid, att.map(a => cmap[a.cid]), att.map(a => a.date), att.map(a => a.time), att.map(a => smap[a.sid]), att.map(a => a.v)]);
  }
  const chg = (b.changes || []).filter(x => cmap[x.cid] && ["cancel", "move", "break"].includes(x.kind) && isDate(x.date));
  for (const x of chg) {
    await c.query(`INSERT INTO class_changes (user_id, class_id, kind, date, time, new_date, new_time, new_duration, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [uid, cmap[x.cid], x.kind, x.date, isTime(x.time) ? x.time : null, isDate(x.newDate) ? x.newDate : null, isTime(x.newTime) ? x.newTime : null,
        Number.isFinite(+x.newDuration) && x.newDuration !== null ? Math.round(+x.newDuration) : null, str(x.note, 300)]);
  }
  const { rows } = await c.query(`SELECT settings FROM users WHERE id=$1`, [uid]);
  const next = { ...DEFAULT_SETTINGS, ...(rows[0]?.settings || {}), ...settingsPatch };
  await c.query(`UPDATE users SET settings=$2 WHERE id=$1`, [uid, next]);
}

r.get("/export", async (req, res) => {
  const all = await loadAll(req.userId);
  const att = await q(`SELECT class_id, to_char(date,'YYYY-MM-DD') AS date, start_time, student_id, status FROM attendance WHERE user_id=$1`, [req.userId]);
  res.setHeader("Content-Disposition", `attachment; filename="tutordesk-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ app: "TutorDesk", version: 3, exported: new Date().toISOString(), settings: all.settings, classes: all.classes, students: all.students, payments: all.payments, changes: all.changes, attendance: att.rows.map(mapAtt) });
});

r.post("/import", async (req, res) => {
  const b = normalizeBackup(req.body);
  if (!b) return res.status(400).json({ error: "not_backup" });
  const s = b.settings || {};
  const patch = {};
  for (const k of ["tutorName", "currency", "cc", "lang"]) if (typeof s[k] === "string") patch[k] = s[k].slice(0, 120);
  if (s.tpl && typeof s.tpl === "object") patch.tpl = s.tpl;
  patch.sample = false;
  await tx(c => importInto(c, req.userId, b, patch));
  res.json(await loadAll(req.userId));
});

r.delete("/", async (req, res) => {
  await tx(async c => {
    await wipe(c, req.userId);
    const { rows } = await c.query(`SELECT settings FROM users WHERE id=$1`, [req.userId]);
    await c.query(`UPDATE users SET settings=$2 WHERE id=$1`, [req.userId, { ...(rows[0]?.settings || {}), sample: false }]);
  });
  res.json(await loadAll(req.userId));
});

export default r;
