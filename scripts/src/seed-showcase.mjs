// Development only: creates a realistic, clearly fictional demo school by driving the real HTTP API,
// exactly as a school would: register, set up the term, add staff and learners, approve fees, bill,
// then receive M-Pesa and cash payments (some match, some need the bursar).
// Needs: a running API, approval switched off, and SHOWCASE_PASSWORD + DAR token free in .env.local.
import { readFileSync, appendFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

const envPath = new URL("../../.env.local", import.meta.url);
const env = Object.fromEntries(readFileSync(envPath, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
if (!env.SHOWCASE_PASSWORD) {
  env.SHOWCASE_PASSWORD = `${randomBytes(9).toString("base64url")}Aa1!`;
  appendFileSync(envPath, `# Showcase demo school (development only)\nSHOWCASE_PASSWORD=${env.SHOWCASE_PASSWORD}\n`);
}
const API = process.env.SHOWCASE_API ?? "http://localhost:8080/api";
const PW = env.SHOWCASE_PASSWORD;
const domain = "mwangaza.test";

async function req(cookie, method, path, body) {
  const r = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${typeof data === "string" ? data : JSON.stringify(data)}`.slice(0, 300));
  return { data, cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}
const as = (cookie) => (m, p, b) => req(cookie, m, p, b).then((x) => x.data);
const login = async (email) => (await req(null, "POST", "/auth/login", { identifier: email, password: PW })).cookie;

// 1. The school registers itself (approval is off, so it opens on its free trial).
const reg = await req(null, "POST", "/auth/register", { schoolName: "Mwangaza Primary School", schoolType: "primary", adminName: "Grace Wanjiru", email: `admin@${domain}`, password: PW });
const admin = as(reg.cookie);
console.log("Registered Mwangaza Primary School");
await admin("PATCH", "/school", { phone: "0722000111", email: `office@${domain}`, county: "Nairobi", address: "Mwangaza Road, Nairobi" });

// 2. Calendar: 2026, Term 3 in progress.
const year = await admin("POST", "/academic-years", { name: "2026", startDate: "2026-01-05", endDate: "2026-10-30", isCurrent: true });
const terms = {};
for (const [name, startDate, endDate] of [["Term 1", "2026-01-05", "2026-04-03"], ["Term 2", "2026-04-27", "2026-07-31"], ["Term 3", "2026-08-24", "2026-10-30"]])
  terms[name] = await admin("POST", "/terms", { academicYearId: year.id, name, startDate, endDate, isCurrent: name === "Term 3" });

// 3. Classes: Grades 4–6, two streams each.
const grades = {}, streams = [];
for (const [i, name] of ["Grade 4", "Grade 5", "Grade 6"].entries()) {
  grades[name] = await admin("POST", "/grades", { name, levelBand: "upper_primary", order: i + 7 });
  for (const s of ["East", "West"]) streams.push({ ...(await admin("POST", "/streams", { gradeId: grades[name].id, name: s })), gradeName: name });
}

// 4. Staff: a principal (approves fees) and a bursar (records payments, assigns unmatched).
await admin("POST", "/users", { name: "Peter Otieno", email: `principal@${domain}`, password: PW, role: "principal" });
await admin("POST", "/users", { name: "Mercy Akinyi", email: `bursar@${domain}`, password: PW, role: "bursar" });
const principal = as(await login(`principal@${domain}`)), bursar = as(await login(`bursar@${domain}`));

// 5. Learners with guardians. Four families have two or three children.
const first = ["Brian", "Faith", "Kevin", "Mercy", "Dennis", "Joy", "Collins", "Sharon", "Ian", "Purity", "Victor", "Esther", "Allan", "Cynthia", "Felix", "Diana", "Samuel", "Linet", "Martin", "Grace", "Elvis", "Naomi", "Hillary", "Ruth", "Ken", "Beatrice", "Mark", "Lydia", "Paul", "Winnie", "Eric", "Stacy", "Tony", "Mary", "James", "Ann"];
const last = ["Kamau", "Otieno", "Wanjiku", "Mutua", "Chebet", "Odhiambo", "Njoroge", "Wambui", "Kiprop", "Achieng", "Mwangi", "Nyambura", "Kimani", "Atieno", "Kariuki", "Jeptoo", "Ndungu", "Omondi", "Muthoni", "Koech"];
const families = [{ surname: "Kamau", phone: "0711200001", children: 3 }, { surname: "Otieno", phone: "0711200002", children: 2 }, { surname: "Chebet", phone: "0711200003", children: 2 }, { surname: "Mwangi", phone: "0711200004", children: 3 }];
const learners = [];
let adm = 1001, fi = 0, si = 0;
const addLearner = async (firstName, lastName, phone, guardianName) => {
  const stream = streams[si++ % streams.length];
  const s = await admin("POST", "/students", { admissionNo: String(adm++), firstName, lastName, gender: si % 2 ? "male" : "female", status: "active", boardingStatus: "day", gradeId: stream.gradeId, streamId: stream.id,
    guardians: [{ name: guardianName, phone, relationship: "parent", isPrimary: true }] });
  learners.push({ ...s, phone, gradeName: stream.gradeName });
};
for (const f of families) for (let c = 0; c < f.children; c++) await addLearner(first[fi++], f.surname, f.phone, `${["Jane", "John", "Alice", "Joseph"][families.indexOf(f)]} ${f.surname}`);
for (let i = 0; fi < first.length; i++) await addLearner(first[fi++], last[(i + 5) % last.length], `0712${String(300000 + i).padStart(6, "0")}`, `${["Lucy", "David", "Rose", "Simon", "Agnes", "Daniel"][i % 6]} ${last[(i + 5) % last.length]}`);
console.log(`Added ${learners.length} learners (4 families with siblings)`);

// 6. Fees: three items, one amount per grade for Term 3; the principal approves (two-person rule).
const items = {};
for (const [i, name] of ["Tuition", "Lunch", "Activity"].entries())
  items[name] = await admin("POST", "/finance/records", { kind: "fee_item", idempotencyKey: randomUUID(), name, code: name.toUpperCase().slice(0, 6), priority: i + 1, isOptional: false });
const amounts = { "Grade 4": [14000, 4500, 1000], "Grade 5": [15000, 4500, 1000], "Grade 6": [16500, 4500, 1500] };
for (const [g, [t, l, a]] of Object.entries(amounts)) {
  const st = await admin("POST", "/finance/records", { kind: "fee_structure", idempotencyKey: randomUUID(), name: `${g} · Term 3`, academicYearId: year.id, termId: terms["Term 3"].id, gradeId: grades[g].id,
    lines: [{ feeItemId: items.Tuition.id, amount: String(t) }, { feeItemId: items.Lunch.id, amount: String(l) }, { feeItemId: items.Activity.id, amount: String(a) }] });
  await principal("POST", `/finance/records/${st.id}/decision`, { decision: "approved", reason: "Approved by the board for Term 3" });
}

// 7. Bill every learner for Term 3 (preview, then commit).
const preview = await bursar("POST", "/finance/invoices/preview", { termId: terms["Term 3"].id, dueDate: "2026-09-15" });
await bursar("POST", "/finance/invoices/commit", { termId: terms["Term 3"].id, dueDate: "2026-09-15", previewToken: preview.previewToken });
console.log(`Billed ${preview.invoices.length} learners for Term 3`);

// 8. The school connects its paybill, then M-Pesa payments arrive (the callback path Safaricom uses).
const token = randomBytes(24).toString("hex");
await admin("PUT", "/integrations/config", { provider: "daraja", environment: "sandbox", enabled: true, credentials: { consumerKey: "demo", consumerSecret: "demo", passkey: "demo", callbackToken: token }, shortcode: "522522" });
const now = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()).replace(/\D/g, "");
const mpesa = (ref, phone, amount, name) => req(null, "POST", `/payments/confirmation/${token}`, { TransID: `SK${randomBytes(4).toString("hex").toUpperCase()}`, TransTime: now, TransAmount: String(amount), BusinessShortCode: "522522", BillRefNumber: ref, MSISDN: phone.replace(/^0/, "254"), FirstName: name });
const singles = learners.slice(10);
for (const [i, l] of singles.slice(0, 16).entries()) await mpesa(i % 5 === 0 ? `adm 0${l.admissionNo}` : l.admissionNo, l.phone, [19500, 10000, 15000, 7500][i % 4], l.firstName.toUpperCase());
await mpesa("", families[0].phone, 30000, "JANE");            // a parent of three, no account number → bursar splits
await mpesa("", "0799123456", 5000, "UNKNOWN");               // unknown phone, no account number
await mpesa(`${singles[17].admissionNo}9`, "0700555111", 8000, "TYPO"); // one-digit typo in the account number
// 9. Cash at the office.
for (const l of singles.slice(18, 20)) await bursar("POST", "/finance/records", { kind: "payment", idempotencyKey: randomUUID(), studentId: l.id, channel: "cash", providerTxnId: `CASH-${randomBytes(3).toString("hex")}`, amount: "12000" });
console.log("Received 19 M-Pesa payments (3 need the bursar) and 2 cash payments");
console.log(`\nSign in as admin@${domain}, principal@${domain} or bursar@${domain} with SHOWCASE_PASSWORD from .env.local`);
