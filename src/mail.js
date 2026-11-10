// Email via Gmail SMTP (use a Gmail "App password", not your normal password).
// Set GMAIL_USER and GMAIL_APP_PASSWORD. For local testing without Gmail, set MAIL_TRANSPORT=log.
import nodemailer from "nodemailer";

const user = process.env.GMAIL_USER;
const pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
const logOnly = process.env.MAIL_TRANSPORT === "log";

export const emailEnabled = logOnly || !!(user && pass);
export const sentLog = []; // used by MAIL_TRANSPORT=log for local testing

let transport;
function getTransport() {
  if (!transport) {
    transport = logOnly
      ? nodemailer.createTransport({ jsonTransport: true })
      : nodemailer.createTransport({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          auth: { user, pass },
        });
  }
  return transport;
}

export async function sendMail({ to, subject, text, html, replyTo }) {
  if (!emailEnabled) throw new Error("email_disabled");
  const from = `"${process.env.MAIL_FROM_NAME || "TutorDesk"}" <${user || "tutordesk@localhost"}>`;
  const info = await getTransport().sendMail({
    from,
    to,
    subject,
    text,
    html,
    replyTo,
  });
  if (logOnly) {
    sentLog.push({ to, subject, text });
    console.log(`[mail:log] to=${to} subject=${subject}\n${text}`);
  }
  return info;
}

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/** Address of the web app, used in emailed links and for the logo image. */
export function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const first = (process.env.FRONTEND_URL || "")
    .split(",")
    .map((s) => s.trim())
    .find((s) => s && !s.includes("*"));
  return (first || "http://localhost:3000").replace(/\/$/, "");
}

const FONT =
  "Inter,-apple-system,'Segoe UI',Roboto,Arial,'Noto Sans Sinhala','Noto Sans Tamil',sans-serif";
const para = (t) =>
  esc(t)
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155">${p.replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

/**
 * Branded HTML email (works in Gmail, Outlook and phone mail apps: tables + inline styles only).
 * lang picks the small fixed texts; details = [[label, value], ...] shown in a grey box; quote = a block of user text.
 */
export function layout({
  lang,
  heading,
  body,
  button,
  link,
  footer,
  preheader,
  details,
  quote,
}) {
  const app = appUrl();
  const logo = `${app}/brand/logo-mark-256.png`;
  const btn =
    button && link
      ? `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px"><tr>
  <td bgcolor="#0277bd" style="border-radius:8px;background:#0277bd;background-image:linear-gradient(135deg,#0277bd,#1e9be6)">
    <a href="${esc(link)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">${esc(button)}</a>
  </td></tr></table>
<p style="margin:18px 0 0;font-size:12.5px;line-height:1.5;color:#64748b">${esc(mt(lang, "link_hint"))}<br>
  <a href="${esc(link)}" style="color:#0277bd;word-break:break-all">${esc(link)}</a></p>`
      : "";
  const box = details?.length
    ? `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 16px;background:#f6f9fc;border:1px solid #e6ebf1;border-radius:10px">
  ${details.map(([k, v]) => `<tr><td style="padding:9px 14px;font-size:12.5px;color:#64748b;width:90px;vertical-align:top">${esc(k)}</td><td style="padding:9px 14px;font-size:13.5px;color:#1a202c;word-break:break-word">${esc(v)}</td></tr>`).join("")}
</table>`
    : "";
  const q = quote
    ? `<div style="margin:0 0 16px;padding:14px 16px;border-left:4px solid #f5a623;background:#fffaf0;border-radius:6px;font-size:14.5px;line-height:1.6;color:#1a202c;white-space:pre-wrap">${esc(quote)}</div>`
    : "";
  return `<!doctype html>
<html lang="${esc(lang || "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:${FONT};color:#1a202c">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader || body || "").slice(0, 140)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f7fb" style="background:#f4f7fb"><tr><td align="center" style="padding:32px 14px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:0 6px 18px">
      <a href="${esc(app)}" style="text-decoration:none">
        <img src="${esc(logo)}" width="40" height="40" alt="" style="vertical-align:middle;border:0;border-radius:10px">
        <span style="vertical-align:middle;margin-left:8px;font-family:Outfit,${FONT};font-size:22px;font-weight:700;letter-spacing:-.3px;color:#1a202c">Tutor<span style="color:#0277bd">Desk</span></span>
      </a>
    </td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e6ebf1;border-radius:14px;overflow:hidden">
      <div style="height:4px;background:#0277bd;background-image:linear-gradient(90deg,#0277bd,#1e9be6 70%,#f5a623);border-radius:14px 14px 0 0;font-size:0;line-height:0">&nbsp;</div>
      <div style="padding:28px 28px 26px">
        <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;color:#1a202c">${esc(heading)}</h1>
        ${body ? para(body) : ""}${q}${box}${btn}
      </div>
      ${footer ? `<div style="padding:16px 28px;border-top:1px solid #e6ebf1;background:#f6f9fc;border-radius:0 0 14px 14px;font-size:13px;line-height:1.55;color:#64748b">${esc(footer)}</div>` : ""}
    </td></tr>
    <tr><td align="center" style="padding:20px 10px 0;font-size:12px;line-height:1.6;color:#94a3b8">
      ${esc(mt(lang, "tagline"))}<br>
      <a href="${esc(app)}" style="color:#64748b;text-decoration:underline">${esc(app.replace(/^https?:\/\//, ""))}</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

/* Email text in the tutor's language: [en, si, ta] */
const T = {
  tagline: [
    "TutorDesk · Classes, attendance and fees for private tutors",
    "TutorDesk · පෞද්ගලික උපකාරක ගුරුවරුන් සඳහා පන්ති, පැමිණීම සහ ගාස්තු",
    "TutorDesk · தனியார் ஆசிரியர்களுக்கான வகுப்புகள், வருகை மற்றும் கட்டணங்கள்",
  ],
  link_hint: [
    "Button not working? Copy this link into your browser:",
    "බොත්තම ක්‍රියා නොකරයිද? මෙම සබැඳිය ඔබේ බ්‍රවුසරයට පිටපත් කරන්න:",
    "பொத்தான் வேலை செய்யவில்லையா? இந்த இணைப்பை உங்கள் உலாவியில் நகலெடுக்கவும்:",
  ],
  changed_button: [
    "Open TutorDesk",
    "TutorDesk විවෘත කරන්න",
    "TutorDesk ஐத் திற",
  ],
  reset_subject: [
    "Reset your TutorDesk password",
    "ඔබේ TutorDesk මුරපදය යළි සකසන්න",
    "உங்கள் TutorDesk கடவுச்சொல்லை மீட்டமைக்கவும்",
  ],
  reset_heading: [
    "Reset your password",
    "ඔබේ මුරපදය යළි සකසන්න",
    "கடவுச்சொல்லை மீட்டமைக்கவும்",
  ],
  reset_body: [
    "Someone (hopefully you) asked to reset the password for this TutorDesk account. Tap the button to choose a new password. The link works for 1 hour.",
    "මෙම TutorDesk ගිණුමේ මුරපදය යළි සැකසීමට ඉල්ලීමක් ලැබී ඇත. නව මුරපදයක් තෝරා ගැනීමට බොත්තම ඔබන්න. සබැඳිය පැය 1ක් වලංගුයි.",
    "இந்த TutorDesk கணக்கின் கடவுச்சொல்லை மீட்டமைக்கக் கோரிக்கை வந்துள்ளது. புதிய கடவுச்சொல்லைத் தேர்வுசெய்ய பொத்தானை அழுத்தவும். இணைப்பு 1 மணி நேரம் செல்லுபடியாகும்.",
  ],
  reset_button: [
    "Choose a new password",
    "නව මුරපදයක් තෝරන්න",
    "புதிய கடவுச்சொல்லைத் தேர்வுசெய்",
  ],
  reset_footer: [
    "If you didn't ask for this, you can ignore this email – your password won't change.",
    "ඔබ මෙය ඉල්ලුවේ නැත්නම්, මෙම ඊමේල් එක නොසලකා හරින්න – ඔබේ මුරපදය වෙනස් නොවේ.",
    "நீங்கள் இதைக் கோரவில்லை என்றால், இந்த மின்னஞ்சலைப் புறக்கணிக்கவும் – உங்கள் கடவுச்சொல் மாறாது.",
  ],
  changed_subject: [
    "Your TutorDesk password was changed",
    "ඔබේ TutorDesk මුරපදය වෙනස් කරන ලදී",
    "உங்கள் TutorDesk கடவுச்சொல் மாற்றப்பட்டது",
  ],
  changed_body: [
    "Your password was just changed and you've been signed out on your other devices. If this wasn't you, reset your password straight away and reply to this email.",
    "ඔබේ මුරපදය දැන් වෙනස් කරන ලද අතර අනෙක් උපාංගවලින් ඔබව ඉවත් කර ඇත. මෙය ඔබ නොකළේ නම්, වහාම මුරපදය යළි සකසා මෙම ඊමේල් එකට පිළිතුරු දෙන්න.",
    "உங்கள் கடவுச்சொல் இப்போது மாற்றப்பட்டது, மற்ற சாதனங்களில் இருந்து வெளியேற்றப்பட்டீர்கள். இது நீங்கள் இல்லையென்றால், உடனே கடவுச்சொல்லை மீட்டமைத்து இந்த மின்னஞ்சலுக்குப் பதிலளிக்கவும்.",
  ],
};
const IDX = { en: 0, si: 1, ta: 2 };
export const mt = (lang, k) => T[k][IDX[lang] ?? 0];
