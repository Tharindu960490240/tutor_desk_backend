import { Router } from "express";
import { q, tx } from "./db.js";
import { loadAll, loadClasses, loadStudents, loadChanges, mapPayment, mapAtt, DEFAULT_SETTINGS } from "./data.js";
import * as V from "./validate.js";
import { z } from "zod";

const r = Router();

/* ---------- everything the app needs on load ---------- */
r.get("/bootstrap", async (req, res) => {
  const data = await loadAll(req.userId);
  if (!data) return res.status(401).json({ error: "unauthorized" });
  res.json(data);
});

/* ---------- settings ---------- */
r.put("/settings", async (req, res) => {
  const b = V.parse(V.settingsBody, req.body, res); if (!b) return;
  const { rows } = await q(`SELECT settings FROM users WHERE id=$1`, [req.userId]);
  const cur = { ...DEFAULT_SETTINGS, ...(rows[0]?.settings || {}) };
  const next = { ...cur, ...b, tpl: { fee: { ...(cur.tpl?.fee || {}), ...(b.tpl?.fee || {}) }, cls: { ...(cur.tpl?.cls || {}), ...(b.tpl?.cls || {}) } } };
  await q(`UPDATE users SET settings=$2 WHERE id=$1`, [req.userId, next]);
  res.json(next);
});

/* ---------- classes (with weekly sessions) ---------- */
/**
 * Save the weekly schedule.
 *  - without effectiveFrom: replace the whole schedule (new class, or fixing a mistake)
 *  - with effectiveFrom: permanent change from that date – the old schedule is kept for earlier dates
 */
async function writeSessions(c, classId, sessions, effectiveFrom) {
  if (!effectiveFrom) {
    await c.query(`DELETE FROM class_sessions WHERE class_id=$1`, [classId]);
  } else {
    // versions that would only start on/after the new date are replaced
    await c.query(`DELETE FROM class_sessions WHERE class_id=$1 AND valid_from IS NOT NULL AND valid_from >= $2::date`, [classId, effectiveFrom]);
    // versions still running on the new date end the day before
    await c.query(`UPDATE class_sessions SET valid_until = $2::date - 1
                   WHERE class_id=$1 AND (valid_until IS NULL OR valid_until >= $2::date)`, [classId, effectiveFrom]);
    // anything that now ends before it starts is pointless
    await c.query(`DELETE FROM class_sessions WHERE class_id=$1 AND valid_from IS NOT NULL AND valid_until IS NOT NULL AND valid_until < valid_from`, [classId]);
  }
  for (const s of sessions) {
    await c.query(`INSERT INTO class_sessions (class_id, weekday, start_time, duration_min, valid_from) VALUES ($1,$2,$3,$4,$5)`,
      [classId, s.day, s.time, s.duration, effectiveFrom || null]);
  }
}

r.post("/classes", async (req, res) => {
  const b = V.parse(V.classBody, req.body, res); if (!b) return;
  const id = await tx(async c => {
    const { rows } = await c.query(
      `INSERT INTO classes (user_id, name, subject, level, location, fee, admission_fee, color) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [req.userId, b.name, b.subject, b.level, b.location, b.fee, b.admissionFee, b.color]);
    await writeSessions(c, rows[0].id, b.sessions);
    return rows[0].id;
  });
  res.status(201).json((await loadClasses(req.userId, id))[0]);
});

r.put("/classes/:id", async (req, res) => {
  const id = V.parse(V.uuid, req.params.id, res); if (!id) return;
  const b = V.parse(V.classBody, req.body, res); if (!b) return;
  const ok = await tx(async c => {
    const u = await c.query(
      `UPDATE classes SET name=$3, subject=$4, level=$5, location=$6, fee=$7, admission_fee=$8, color=$9 WHERE id=$1 AND user_id=$2`,
      [id, req.userId, b.name, b.subject, b.level, b.location, b.fee, b.admissionFee, b.color]);
    if (!u.rowCount) return false;
    await writeSessions(c, id, b.sessions, b.effectiveFrom);
    return true;
  });
  if (!ok) return res.status(404).json({ error: "not_found" });
  res.json((await loadClasses(req.userId, id))[0]);
});

// Stop a class permanently after a date (or restart it with endsOn: null)
r.put("/classes/:id/end", async (req, res) => {
  const id = V.parse(V.uuid, req.params.id, res); if (!id) return;
  const b = V.parse(z.object({ endsOn: V.date.nullable() }), req.body, res); if (!b) return;
  const u = await q(`UPDATE classes SET ends_on=$3 WHERE id=$1 AND user_id=$2`, [id, req.userId, b.endsOn]);
  if (!u.rowCount) return res.status(404).json({ error: "not_found" });
  res.json((await loadClasses(req.userId, id))[0]);
});

/* ---------- one-off timetable changes: cancel / move / break ---------- */
r.post("/classes/:id/changes", async (req, res) => {
  const id = V.parse(V.uuid, req.params.id, res); if (!id) return;
  const b = V.parse(V.changeBody, req.body, res); if (!b) return;
  const own = await q(`SELECT 1 FROM classes WHERE id=$1 AND user_id=$2`, [id, req.userId]);
  if (!own.rowCount) return res.status(404).json({ error: "not_found" });
  // one change per meeting: replace an earlier cancel/move of the same meeting
  if (b.kind !== "break") await q(`DELETE FROM class_changes WHERE class_id=$1 AND kind IN ('cancel','move') AND date=$2 AND time=$3`, [id, b.date, b.time]);
  const { rows } = await q(
    `INSERT INTO class_changes (user_id, class_id, kind, date, time, new_date, new_time, new_duration, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [req.userId, id, b.kind, b.date, b.kind === "break" ? null : b.time, b.kind === "cancel" ? null : b.newDate,
      b.kind === "move" ? b.newTime : null, b.kind === "move" ? (b.newDuration ?? null) : null, b.note]);
  res.status(201).json((await loadChanges(req.userId, rows[0].id))[0]);
});

r.delete("/changes/:id", async (req, res) => {
  const id = V.parse(V.uuid, req.params.id, res); if (!id) return;
  const d = await q(`DELETE FROM class_changes WHERE id=$1 AND user_id=$2`, [id, req.userId]);
  if (!d.rowCount) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

r.delete("/classes/:id", async (req, res) => {
  const id = V.parse(V.uuid, req.params.id, res); if (!id) return;
  const d = await q(`DELETE FROM classes WHERE id=$1 AND user_id=$2`, [id, req.userId]);
  if (!d.rowCount) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

/* ---------- students ---------- */
async function ownClassIds(c, uid, ids) {
  if (!ids.length) return [];
  const { rows } = await c.query(`SELECT id FROM classes WHERE user_id=$1 AND id = ANY($2::uuid[])`, [uid, ids]);
  return rows.map(r => r.id);
}
async function writeLinks(c, uid, sid, ids, waived = []) {
  await c.query(`DELETE FROM student_classes WHERE student_id=$1`, [sid]);
  for (const cid of await ownClassIds(c, uid, ids)) {
    await c.query(`INSERT INTO student_classes (student_id, class_id, admission_waived) VALUES ($1,$2,$3)`, [sid, cid, waived.includes(cid)]);
  }
}

r.post("/students", async (req, res) => {
  const b = V.parse(V.studentBody, req.body, res); if (!b) return;
  const id = await tx(async c => {
    const { rows } = await c.query(
      `INSERT INTO students (user_id, name, parent, parent_phone, phone, fee, joined, notes, lang)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8,$9) RETURNING id`,
      [req.userId, b.name, b.parent, b.parentPhone, b.phone, b.fee, b.joined || null, b.notes, b.lang]);
    await writeLinks(c, req.userId, rows[0].id, b.classIds, b.admissionWaived);
    return rows[0].id;
  });
  res.status(201).json((await loadStudents(req.userId, id))[0]);
});

r.put("/students/:id", async (req, res) => {
  const id = V.parse(V.uuid, req.params.id, res); if (!id) return;
  const b = V.parse(V.studentBody, req.body, res); if (!b) return;
  const ok = await tx(async c => {
    const u = await c.query(
      `UPDATE students SET name=$3, parent=$4, parent_phone=$5, phone=$6, fee=$7, joined=COALESCE($8::date, joined), notes=$9, lang=$10
       WHERE id=$1 AND user_id=$2`,
      [id, req.userId, b.name, b.parent, b.parentPhone, b.phone, b.fee, b.joined || null, b.notes, b.lang]);
    if (!u.rowCount) return false;
    await writeLinks(c, req.userId, id, b.classIds, b.admissionWaived);
    return true;
  });
  if (!ok) return res.status(404).json({ error: "not_found" });
  res.json((await loadStudents(req.userId, id))[0]);
});

// Mark a student as left / returned
r.put("/students/:id/active", async (req, res) => {
  const id = V.parse(V.uuid, req.params.id, res); if (!id) return;
  const b = V.parse(z.object({ active: z.boolean(), endedYm: V.ym.optional() }), req.body, res); if (!b) return;
  const u = await q(`UPDATE students SET active=$3, ended_ym=$4 WHERE id=$1 AND user_id=$2`,
    [id, req.userId, b.active, b.active ? null : (b.endedYm || new Date().toISOString().slice(0, 7))]);
  if (!u.rowCount) return res.status(404).json({ error: "not_found" });
  res.json((await loadStudents(req.userId, id))[0]);
});

r.delete("/students/:id", async (req, res) => {
  const id = V.parse(V.uuid, req.params.id, res); if (!id) return;
  const d = await q(`DELETE FROM students WHERE id=$1 AND user_id=$2`, [id, req.userId]);
  if (!d.rowCount) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

/* ---------- payments ---------- */
r.post("/payments", async (req, res) => {
  const b = V.parse(V.paymentBody, req.body, res); if (!b) return;
  const own = await q(`SELECT 1 FROM students WHERE id=$1 AND user_id=$2`, [b.sid, req.userId]);
  if (!own.rowCount) return res.status(404).json({ error: "not_found" });
  if (b.kind === "admission") {
    if (!b.cid) return res.status(400).json({ error: "invalid", issues: [{ path: "cid", message: "class required" }] });
    const c = await q(`SELECT 1 FROM classes WHERE id=$1 AND user_id=$2`, [b.cid, req.userId]);
    if (!c.rowCount) return res.status(404).json({ error: "not_found" });
  }
  const { rows } = await q(
    `INSERT INTO payments (user_id, student_id, kind, class_id, ym, amount, paid_on, method, note)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8,$9) RETURNING *`,
    [req.userId, b.sid, b.kind, b.kind === "admission" ? b.cid : null, b.ym, b.amount, b.date || null, b.method, b.note]);
  res.status(201).json(mapPayment(rows[0]));
});

r.delete("/payments/:id", async (req, res) => {
  const id = V.parse(V.uuid, req.params.id, res); if (!id) return;
  const d = await q(`DELETE FROM payments WHERE id=$1 AND user_id=$2`, [id, req.userId]);
  if (!d.rowCount) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

/* ---------- attendance ---------- */
r.get("/attendance", async (req, res) => {
  const b = V.parse(z.object({ from: V.date, to: V.date }), req.query, res); if (!b) return;
  const { rows } = await q(
    `SELECT class_id, to_char(date,'YYYY-MM-DD') AS date, start_time, student_id, status FROM attendance
     WHERE user_id=$1 AND date BETWEEN $2 AND $3`, [req.userId, b.from, b.to]);
  res.json(rows.map(mapAtt));
});

async function ownsBoth(uid, cid, sids) {
  const c = await q(`SELECT 1 FROM classes WHERE id=$1 AND user_id=$2`, [cid, uid]);
  if (!c.rowCount) return false;
  const s = await q(`SELECT count(*)::int AS n FROM students WHERE user_id=$1 AND id = ANY($2::uuid[])`, [uid, sids]);
  return s.rows[0].n === new Set(sids).size;
}

async function mark(c, uid, { cid, date, time, sid, v }) {
  if (v) {
    await c.query(
      `INSERT INTO attendance (user_id, class_id, date, start_time, student_id, status) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (class_id, date, start_time, student_id) DO UPDATE SET status=EXCLUDED.status`,
      [uid, cid, date, time, sid, v]);
  } else {
    await c.query(`DELETE FROM attendance WHERE user_id=$1 AND class_id=$2 AND date=$3 AND start_time=$4 AND student_id=$5`,
      [uid, cid, date, time, sid]);
  }
}

r.put("/attendance", async (req, res) => {
  const b = V.parse(V.attBody, req.body, res); if (!b) return;
  if (!(await ownsBoth(req.userId, b.cid, [b.sid]))) return res.status(404).json({ error: "not_found" });
  await mark({ query: q }, req.userId, b);
  res.json({ ok: true });
});

r.put("/attendance/bulk", async (req, res) => {
  const b = V.parse(V.attBulk, req.body, res); if (!b) return;
  const sids = Object.keys(b.marks);
  if (sids.some(s => !V.uuid.safeParse(s).success)) return res.status(400).json({ error: "invalid" });
  if (!(await ownsBoth(req.userId, b.cid, sids))) return res.status(404).json({ error: "not_found" });
  await tx(async c => { for (const sid of sids) await mark(c, req.userId, { ...b, sid, v: b.marks[sid] }); });
  res.json({ ok: true });
});

/* ---------- reminder log ---------- */
r.post("/reminders", async (req, res) => {
  const b = V.parse(z.object({ sid: V.uuid, type: z.enum(["fee", "class", "change", "admission"]), key: z.string().max(120).default("") }), req.body, res); if (!b) return;
  const own = await q(`SELECT 1 FROM students WHERE id=$1 AND user_id=$2`, [b.sid, req.userId]);
  if (!own.rowCount) return res.status(404).json({ error: "not_found" });
  const { rows } = await q(`INSERT INTO reminder_log (user_id, student_id, type, key) VALUES ($1,$2,$3,$4) RETURNING sent_at`,
    [req.userId, b.sid, b.type, b.key]);
  res.status(201).json({ sid: b.sid, type: b.type, key: b.key, at: rows[0].sent_at });
});

export default r;
