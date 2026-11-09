import { q } from "./db.js";
import { isAdminEmail } from "./admin.js";

export const DEFAULT_SETTINGS = { tutorName: "", currency: "Rs", cc: "94", lang: "en", tpl: {}, sample: false };

export const mapClass = (c, sessions) => ({
  id: c.id, name: c.name, subject: c.subject, level: c.level, location: c.location,
  fee: c.fee, admissionFee: c.admission_fee, color: c.color, endsOn: c.ends_on,
  // every weekly session, including past/future versions (validFrom/validUntil) after permanent changes
  sessions: sessions.filter(s => s.class_id === c.id)
    .map(s => ({ id: s.id, day: s.weekday, time: s.start_time, duration: s.duration_min, validFrom: s.valid_from, validUntil: s.valid_until }))
    .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time)),
});

export const mapChange = x => ({
  id: x.id, cid: x.class_id, kind: x.kind, date: x.date, time: x.time ? x.time.trim() : null,
  newDate: x.new_date, newTime: x.new_time ? x.new_time.trim() : null, newDuration: x.new_duration, note: x.note, createdAt: x.created_at,
});

export const mapStudent = (s, links) => ({
  id: s.id, name: s.name, parent: s.parent, parentPhone: s.parent_phone, phone: s.phone,
  fee: s.fee, joined: s.joined, notes: s.notes, active: s.active, endedYm: s.ended_ym, lang: s.lang,
  classIds: links.filter(l => l.student_id === s.id).map(l => l.class_id),
  admissionWaived: links.filter(l => l.student_id === s.id && l.admission_waived).map(l => l.class_id),
});

export const mapPayment = p => ({
  id: p.id, sid: p.student_id, kind: p.kind, cid: p.class_id, ym: p.ym, amount: p.amount, date: p.paid_on, method: p.method, note: p.note,
});

export const mapAtt = a => ({ cid: a.class_id, date: a.date, time: a.start_time, sid: a.student_id, v: a.status });

export async function loadClasses(uid, id) {
  const cls = (await q(`SELECT * FROM classes WHERE user_id=$1 ${id ? "AND id=$2" : ""} ORDER BY created_at, name`, id ? [uid, id] : [uid])).rows;
  const ses = (await q(`SELECT s.* FROM class_sessions s JOIN classes c ON c.id=s.class_id WHERE c.user_id=$1`, [uid])).rows;
  return cls.map(c => mapClass(c, ses));
}

export async function loadStudents(uid, id) {
  const st = (await q(`SELECT * FROM students WHERE user_id=$1 ${id ? "AND id=$2" : ""} ORDER BY name`, id ? [uid, id] : [uid])).rows;
  const links = (await q(`SELECT sc.* FROM student_classes sc JOIN students s ON s.id=sc.student_id WHERE s.user_id=$1`, [uid])).rows;
  return st.map(s => mapStudent(s, links));
}

export async function loadChanges(uid, id) {
  const { rows } = await q(`SELECT * FROM class_changes WHERE user_id=$1 ${id ? "AND id=$2" : ""} ORDER BY date, time NULLS FIRST`, id ? [uid, id] : [uid]);
  return rows.map(mapChange);
}

export async function loadAll(uid) {
  const [u, classes, students, pays, log, changes] = await Promise.all([
    q(`SELECT id, email, name, settings, to_char(created_at,'YYYY-MM') AS since FROM users WHERE id=$1`, [uid]),
    loadClasses(uid),
    loadStudents(uid),
    q(`SELECT * FROM payments WHERE user_id=$1 ORDER BY paid_on DESC, created_at DESC`, [uid]),
    q(`SELECT student_id, type, key, sent_at FROM reminder_log WHERE user_id=$1 ORDER BY sent_at DESC LIMIT 1000`, [uid]),
    loadChanges(uid),
  ]);
  const user = u.rows[0];
  if (!user) return null;
  return {
    user: { id: user.id, email: user.email, name: user.name, since: user.since, isAdmin: isAdminEmail(user.email) },
    settings: { ...DEFAULT_SETTINGS, ...user.settings },
    classes, students,
    payments: pays.rows.map(mapPayment),
    changes,
    reminders: log.rows.map(r => ({ sid: r.student_id, type: r.type, key: r.key, at: r.sent_at })),
  };
}
