// Admin helper: set a new password for a tester who is locked out.
//   npm run reset-password -- someone@example.com NewPassword123
import bcrypt from "bcryptjs";
import { pool, ensureSchema } from "../src/db.js";

const [email, pw] = process.argv.slice(2);
if (!email || !pw || !(pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw) && /[@$!%*?&]/.test(pw))) {
  console.error("Usage: npm run reset-password -- <email> <new password>\nPassword needs 8+ characters, a capital, a small letter, a number and one of @$!%*?&");
  process.exit(1);
}
await ensureSchema();
const { rowCount } = await pool.query(
  `UPDATE users SET password_hash=$2, token_version=token_version+1 WHERE lower(email)=lower($1)`,
  [email, await bcrypt.hash(pw, 10)]);
console.log(rowCount ? `Password updated for ${email}. They are signed out everywhere and can sign in with the new password.` : `No account found for ${email}.`);
await pool.end();
