import { z } from "zod";

export const ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const uuid = z.string().uuid();
const txt = (max = 200) => z.string().trim().max(max).default("");
const money = z.coerce.number().min(0).max(1e9).default(0);
export const LANGS = ["en", "si", "ta"];

export const session = z.object({
  day: z.coerce.number().int().min(0).max(6),
  time,
  duration: z.coerce.number().int().min(0).max(24 * 60).default(60),
});

// One-off timetable change. cancel: date+time. move: date+time -> newDate/newTime. break: date..newDate
export const changeBody = z.object({
  kind: z.enum(["cancel", "move", "break"]),
  date,
  time: time.nullable().optional(),
  newDate: date.nullable().optional(),
  newTime: time.nullable().optional(),
  newDuration: z.coerce.number().int().min(0).max(24 * 60).nullable().optional(),
  note: z.string().trim().max(300).default(""),
}).superRefine((b, ctx) => {
  if (b.kind !== "break" && !b.time) ctx.addIssue({ code: "custom", path: ["time"], message: "time required" });
  if (b.kind === "move" && (!b.newDate || !b.newTime)) ctx.addIssue({ code: "custom", path: ["newDate"], message: "new date and time required" });
  if (b.kind === "break" && (!b.newDate || b.newDate < b.date)) ctx.addIssue({ code: "custom", path: ["newDate"], message: "end date must be on or after start" });
});

export const classBody = z.object({
  name: z.string().trim().min(1).max(120),
  subject: txt(), level: txt(), location: txt(200),
  fee: money,
  admissionFee: money,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#0288d1"),
  sessions: z.array(session).max(50).default([]),
  // when the weekly schedule is changed on an existing class: the date the new schedule starts
  effectiveFrom: date.optional(),
});

export const studentBody = z.object({
  name: z.string().trim().min(1).max(120),
  parent: txt(), parentPhone: txt(40), phone: txt(40),
  fee: money,
  joined: date.optional(),
  notes: txt(2000),
  lang: z.enum(LANGS).default("en"),
  classIds: z.array(uuid).max(50).default([]),
  admissionWaived: z.array(uuid).max(50).default([]),
  active: z.boolean().optional(),
});

export const paymentBody = z.object({
  sid: uuid, ym,
  kind: z.enum(["monthly", "admission"]).default("monthly"),
  cid: uuid.nullable().optional(),
  amount: z.coerce.number().positive().max(1e9),
  date: date.optional(),
  method: z.enum(["cash", "bank", "mobile", "card", "other"]).default("cash"),
  note: txt(300),
});

export const attBody = z.object({
  cid: uuid, date, time, sid: uuid,
  v: z.enum(["P", "L", "A"]).nullable(),
});

export const attBulk = z.object({
  cid: uuid, date, time,
  marks: z.record(z.string(), z.enum(["P", "L", "A"]).nullable()),
});

const tplLangs = z.object({ en: z.string().max(1000).optional(), si: z.string().max(1000).optional(), ta: z.string().max(1000).optional() }).partial();
export const settingsBody = z.object({
  tutorName: z.string().trim().max(120).optional(),
  currency: z.string().trim().max(6).optional(),
  cc: z.string().regex(/^\d{0,4}$/).optional(),
  lang: z.enum(LANGS).optional(),
  tpl: z.object({ fee: tplLangs.optional(), cls: tplLangs.optional() }).optional(),
  sample: z.boolean().optional(),
});

/** Express helper: parse body or reply 400. */
export function parse(schema, data, res) {
  const r = schema.safeParse(data);
  if (!r.success) {
    res.status(400).json({ error: "invalid", issues: r.error.issues.map(i => ({ path: i.path.join("."), message: i.message })) });
    return null;
  }
  return r.data;
}
