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
      : nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
  }
  return transport;
}

export async function sendMail({ to, subject, text, html, replyTo }) {
  if (!emailEnabled) throw new Error("email_disabled");
  const from = `"${process.env.MAIL_FROM_NAME || "TutorDesk"}" <${user || "tutordesk@localhost"}>`;
  const info = await getTransport().sendMail({ from, to, subject, text, html, replyTo });
  if (logOnly) {
    sentLog.push({ to, subject, text });
    console.log(`[mail:log] to=${to} subject=${subject}\n${text}`);
  }
  return info;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Simple, readable HTML email with one button. */
export function layout({ heading, body, button, link, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#f5f9fc;font-family:Roboto,Arial,'Noto Sans Sinhala','Noto Sans Tamil',sans-serif;color:#15212b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:20px;border:1px solid #dce6ed" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px 28px 8px"><div style="display:inline-block;background:#0277bd;color:#fff;border-radius:12px;padding:8px 12px;font-weight:700">TutorDesk</div></td></tr>
<tr><td style="padding:8px 28px"><h1 style="font-size:22px;margin:8px 0 12px">${esc(heading)}</h1><p style="font-size:15px;line-height:1.55;margin:0 0 20px">${esc(body)}</p>
${button ? `<a href="${esc(link)}" style="display:inline-block;background:#0277bd;color:#fff;text-decoration:none;border-radius:20px;padding:12px 24px;font-weight:600">${esc(button)}</a>
<p style="font-size:12.5px;color:#4b5c6a;margin:20px 0 0;word-break:break-all">${esc(link)}</p>` : ""}</td></tr>
<tr><td style="padding:20px 28px 28px;font-size:12.5px;color:#4b5c6a">${esc(footer || "")}</td></tr>
</table></td></tr></table></body></html>`;
}

/* Email text in the tutor's language: [en, si, ta] */
const T = {
  reset_subject: ["Reset your TutorDesk password", "ඔබේ TutorDesk මුරපදය යළි සකසන්න", "உங்கள் TutorDesk கடவுச்சொல்லை மீட்டமைக்கவும்"],
  reset_heading: ["Reset your password", "ඔබේ මුරපදය යළි සකසන්න", "கடவுச்சொல்லை மீட்டமைக்கவும்"],
  reset_body: [
    "Someone (hopefully you) asked to reset the password for this TutorDesk account. Tap the button to choose a new password. The link works for 1 hour.",
    "මෙම TutorDesk ගිණුමේ මුරපදය යළි සැකසීමට ඉල්ලීමක් ලැබී ඇත. නව මුරපදයක් තෝරා ගැනීමට බොත්තම ඔබන්න. සබැඳිය පැය 1ක් වලංගුයි.",
    "இந்த TutorDesk கணக்கின் கடவுச்சொல்லை மீட்டமைக்கக் கோரிக்கை வந்துள்ளது. புதிய கடவுச்சொல்லைத் தேர்வுசெய்ய பொத்தானை அழுத்தவும். இணைப்பு 1 மணி நேரம் செல்லுபடியாகும்.",
  ],
  reset_button: ["Choose a new password", "නව මුරපදයක් තෝරන්න", "புதிய கடவுச்சொல்லைத் தேர்வுசெய்"],
  reset_footer: [
    "If you didn't ask for this, you can ignore this email – your password won't change.",
    "ඔබ මෙය ඉල්ලුවේ නැත්නම්, මෙම ඊමේල් එක නොසලකා හරින්න – ඔබේ මුරපදය වෙනස් නොවේ.",
    "நீங்கள் இதைக் கோரவில்லை என்றால், இந்த மின்னஞ்சலைப் புறக்கணிக்கவும் – உங்கள் கடவுச்சொல் மாறாது.",
  ],
  changed_subject: ["Your TutorDesk password was changed", "ඔබේ TutorDesk මුරපදය වෙනස් කරන ලදී", "உங்கள் TutorDesk கடவுச்சொல் மாற்றப்பட்டது"],
  changed_body: [
    "Your password was just changed and you've been signed out on your other devices. If this wasn't you, reset your password straight away and reply to this email.",
    "ඔබේ මුරපදය දැන් වෙනස් කරන ලද අතර අනෙක් උපාංගවලින් ඔබව ඉවත් කර ඇත. මෙය ඔබ නොකළේ නම්, වහාම මුරපදය යළි සකසා මෙම ඊමේල් එකට පිළිතුරු දෙන්න.",
    "உங்கள் கடவுச்சொல் இப்போது மாற்றப்பட்டது, மற்ற சாதனங்களில் இருந்து வெளியேற்றப்பட்டீர்கள். இது நீங்கள் இல்லையென்றால், உடனே கடவுச்சொல்லை மீட்டமைத்து இந்த மின்னஞ்சலுக்குப் பதிலளிக்கவும்.",
  ],
};
const IDX = { en: 0, si: 1, ta: 2 };
export const mt = (lang, k) => T[k][IDX[lang] ?? 0];
