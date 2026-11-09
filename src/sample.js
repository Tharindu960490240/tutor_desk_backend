// Clearly-marked sample data so a new tutor can explore the app.
const pad = n => String(n).padStart(2, "0");
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); };
const addMonths = (ym, n) => { let [y, m] = ym.split("-").map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${pad(m)}`; };

export function buildSample(today = dstr(new Date())) {
  const now = parseD(today), dow = now.getDay(), ym = today.slice(0, 7), prev = addMonths(ym, -1);
  const classes = [
    { id: "c-math", name: "Grade 11 Maths (O/L)", subject: "Mathematics", level: "Grade 11", location: "Home class, Nugegoda", fee: 3000, color: "#0288d1",
      sessions: [{ day: 1, time: "15:30", duration: 90 }, { day: 3, time: "15:30", duration: 90 }] },
    { id: "c-sci", name: "Grade 8 Science", subject: "Science", level: "Grade 8", location: "Home class, Nugegoda", fee: 2500, color: "#00897b",
      sessions: [{ day: 2, time: "16:00", duration: 60 }, { day: 4, time: "16:00", duration: 60 }] },
    // Meets on Saturday morning AND evening, plus today – shows multiple sessions per day
    { id: "c-phy", name: "A/L Physics", subject: "Physics", level: "A/L 2027", location: "Community hall, Maharagama", fee: 3500, admissionFee: 1500, color: "#5c6bc0",
      sessions: [{ day: 6, time: "08:00", duration: 120 }, { day: 6, time: "14:00", duration: 90 },
        ...(dow !== 6 ? [{ day: dow, time: "17:30", duration: 90 }] : [])] },
  ];
  const joined = addMonths(ym, -3) + "-01";
  const mk = (id, name, parent, ph, cls, fee, lang) => ({ id, name, parent, phone: "", parentPhone: ph, classIds: cls, fee, joined, notes: "", active: true, lang });
  const students = [
    mk("s1", "Amaya Perera", "Nimali Perera", "077 123 4561", ["c-math"], 3000, "si"),
    mk("s2", "Kavindu Silva", "Ruwan Silva", "071 234 5672", ["c-math", "c-phy"], 6500, "si"),
    mk("s3", "Priya Rajendran", "Rajendran Kumar", "076 345 6783", ["c-sci"], 2500, "ta"),
    mk("s4", "Dinuka Bandara", "Chaminda Bandara", "077 456 7894", ["c-math"], 3000, "si"),
    mk("s5", "Tharushi Fernando", "Dilani Fernando", "070 567 8905", ["c-phy"], 3500, "en"),
    mk("s6", "Ahamed Rizwan", "Mohamed Rizwan", "075 678 9016", ["c-sci"], 2500, "ta"),
    mk("s7", "Sanjay Selvam", "Selvam Nadarajah", "077 789 0127", ["c-phy"], 3500, "ta"),
    mk("s8", "Nethmi Jayasinghe", "Sunil Jayasinghe", "071 890 1238", ["c-sci", "c-math"], 5000, "si"),
    mk("s9", "Fathima Nazeer", "Nazeer Ahamed", "078 901 2349", ["c-sci"], 2500, "en"),
  ];
  students[7].notes = "Sibling of a past student – Rs 500 discount.";
  students[1].admissionWaived = ["c-phy"]; // Kavindu: admission fee waived

  const payments = [];
  const meth = i => ["cash", "bank", "mobile"][i % 3];
  const addPay = (sid, m, amount, day, method) => {
    const dd = m === ym ? Math.min(day, now.getDate()) : day;
    payments.push({ sid, ym: m, amount, date: `${m}-${pad(dd)}`, method, note: "" });
  };
  for (const back of [3, 2]) { const m = addMonths(ym, -back); students.forEach((s, i) => addPay(s.id, m, s.fee, 3 + i, meth(i))); }
  students.forEach((s, i) => { if (i !== 5) addPay(s.id, prev, s.fee, 2 + i, meth(i + 1)); });
  addPay("s1", ym, 3000, 2, "cash"); addPay("s3", ym, 2500, 3, "bank"); addPay("s5", ym, 3500, 4, "mobile");
  addPay("s7", ym, 3500, 5, "cash"); addPay("s2", ym, 3000, 5, "bank");

  const attendance = [];
  let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 28; i >= 1; i--) {
    const ds = addDays(today, -i), d = parseD(ds).getDay();
    for (const c of classes) {
      for (const s of c.sessions.filter(x => x.day === d)) {
        students.filter(st => st.classIds.includes(c.id)).forEach(st => {
          const r = rnd(), weak = st.id === "s6" ? 0.35 : 0.08;
          attendance.push({ cid: c.id, date: ds, time: s.time, sid: st.id, v: r < weak ? "A" : r < weak + 0.07 ? "L" : "P" });
        });
      }
    }
  }
  // admission fee for A/L Physics: Tharushi paid, Sanjay still owes, Kavindu waived
  payments.push({ sid: "s5", kind: "admission", cid: "c-phy", ym: addMonths(ym, -3), amount: 1500, date: joined, method: "cash", note: "" });

  // timetable changes: next Maths class cancelled, next Science class moved to a later time
  const nextOn = (day, from = 1) => { for (let i = from; i < from + 7; i++) { const d = addDays(today, i); if (parseD(d).getDay() === day) return d; } };
  const changes = [
    { cid: "c-math", kind: "cancel", date: nextOn(1), time: "15:30", note: "Teacher training day" },
    { cid: "c-sci", kind: "move", date: nextOn(4), time: "16:00", newDate: nextOn(4), newTime: "17:30", newDuration: 60, note: "" },
  ];
  return { app: "TutorDesk", version: 4, classes, students, payments, attendance, changes };
}
