/**
 * Standalone SMTP credential test.
 *
 * Talks to the mail server directly, outside the app and outside the database,
 * so a failure here proves the credentials are wrong rather than the app being
 * misconfigured. Prints the raw server dialogue.
 *
 *   node scripts/test-smtp.mjs <user> <password> [host] [port]
 *
 * Example:
 *   node scripts/test-smtp.mjs info@securovix.cloud "abcd1234efgh" smtp.zoho.eu 465
 *
 * The password is never logged, only its length and whether it contains spaces.
 */

import { readFileSync } from "node:fs";

import nodemailer from "nodemailer";

const [, , user, passwordArg, host = "smtp.zoho.eu", portArg = "465"] = process.argv;

if (!user || !passwordArg) {
  console.error("Usage: node scripts/test-smtp.mjs <user> <password|@file> [host] [port]");
  console.error("");
  console.error("Passwords containing $ \\ > ) ; are mangled by the shell before");
  console.error("node ever sees them. Put the password alone in a file and pass");
  console.error("@path instead:");
  console.error("  node scripts/test-smtp.mjs you@example.com @pass.txt");
  process.exit(1);
}

// @file reads the password verbatim, bypassing shell quoting entirely.
const password = passwordArg.startsWith("@")
  ? readFileSync(passwordArg.slice(1), "utf8").replace(/\r?\n$/, "")
  : passwordArg;

const port = Number(portArg);
const secure = port === 465;

console.log("Testing SMTP");
console.log(`  host     : ${host}:${port} (${secure ? "implicit TLS" : "STARTTLS"})`);
console.log(`  user     : ${user}`);
console.log(`  password : ${password.length} characters`);

// A pasted app password with spaces left in is one of the most common causes of
// a rejected login, and it is invisible in a password field.
if (/\s/.test(password)) {
  console.log("  WARNING  : the password contains whitespace — Zoho displays app");
  console.log("             passwords in spaced groups, but they must be pasted");
  console.log("             without the spaces.");
}
// Smart quotes and dashes are the classic sign a password was copied through
// something that auto-formatted it. They are not what the provider generated.
const typographic = password.match(/[‐-―‘’“”…]/g);
if (typographic) {
  console.log(
    `  WARNING  : contains typographic characters (${[...new Set(typographic)].join(" ")})`,
  );
  console.log("             — an en-dash or smart quote means the text was reformatted");
  console.log("             somewhere in transit. Re-copy it from the source.");
}
console.log("");

const transport = nodemailer.createTransport({
  host,
  port,
  secure,
  requireTLS: !secure,
  auth: { user, pass: password },
  connectionTimeout: 20_000,
  greetingTimeout: 15_000,
  socketTimeout: 30_000,
  // Print the full SMTP conversation, which is what actually diagnoses this.
  logger: true,
  debug: true,
});

try {
  await transport.verify();
  console.log("\nRESULT: SUCCESS — the server accepted these credentials.");
  console.log("If the app still fails with the same values, the mismatch is in");
  console.log("what was saved, not in the credentials themselves.");
  process.exit(0);
} catch (err) {
  console.log("\nRESULT: REJECTED");
  console.log(`  code         : ${err.code ?? "(none)"}`);
  console.log(`  responseCode : ${err.responseCode ?? "(none)"}`);
  console.log(`  message      : ${err.message}`);
  if (err.response) console.log(`  server said  : ${err.response}`);

  if (err.responseCode === 535 || err.code === "EAUTH") {
    console.log("\n535 means the server understood the login and refused it. Either");
    console.log("the password is not an app-specific password, or SMTP access is");
    console.log("not enabled for this mailbox in the Zoho control panel.");
  }
  process.exit(1);
} finally {
  transport.close();
}
