// Release 1 matching acceptance: drives the real M-Pesa paybill endpoints against a running local API.
// Uses the "Trial Expiry School" test tenant. Prints PASS/FAIL per spec scenario; never prints secrets.
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

const API = process.env.MATCHING_API ?? "http://localhost:8080/api";

const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

async function login(identifier, password) {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier, password }) });
  if (!r.ok) throw new Error(`login ${identifier} ${r.status}`);
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const call = (cookie) => async (method, path, body) => {
  const r = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
};

const admin = call(await login(env.MATCHING_SCHOOL_EMAIL ?? "trial@expiry.test", env.TEST_SCHOOL_PASSWORD));
const run = Date.now().toString(36).slice(-5).toUpperCase();

// Bursar for queue resolution
const bursarEmail = `bursar-${run.toLowerCase()}@expiry.test`;
await admin("POST", "/users", { name: "Test Bursar", email: bursarEmail, password: env.TEST_SCHOOL_PASSWORD, role: "bursar" });
const bursar = call(await login(bursarEmail, env.TEST_SCHOOL_PASSWORD));

// School M-Pesa connection (no Safaricom call is made by callbacks)
const token = randomBytes(24).toString("hex");
const cfg = await admin("PUT", "/integrations/config", { provider: "daraja", environment: "sandbox", enabled: true, credentials: { consumerKey: "test", consumerSecret: "test", passkey: "test", callbackToken: token }, shortcode: "600000" });
if (cfg.status >= 300) throw new Error(`integration setup ${cfg.status} ${JSON.stringify(cfg.data)}`);

// Learners: one single child, one family of three, unique numbers per run
const streams = (await admin("GET", "/streams")).data;
const s7 = streams.find((x) => x.gradeName === "Grade 7" && x.name === "East") ?? streams[0];
const n = (base) => `${base}${run.replace(/\D/g, "").slice(0, 2) || "1"}`;
const single = n("12"), fam = [n("31"), n("32"), n("33")];
const ph1 = `07${String(Date.now()).slice(-8)}`, ph2 = `07${String(Date.now() + 7).slice(-8)}`;
const mk = (adm, phone, gname) => admin("POST", "/students", { admissionNo: adm, firstName: "Test", lastName: `L${adm}`, status: "active", boardingStatus: "day", gradeId: s7.gradeId, streamId: s7.id, guardians: [{ name: gname, phone, relationship: "parent", isPrimary: true }] });
for (const [adm, ph, g] of [[single, ph1, "Single Parent"], ...fam.map((a) => [a, ph2, "Family Parent"])]) {
  const r = await mk(adm, ph, g); if (r.status >= 300) throw new Error(`student ${adm} ${r.status} ${JSON.stringify(r.data)}`);
}
const students = (await admin("GET", "/students")).data;
const sid = (adm) => students.find((x) => x.admissionNo === adm).id;

const t = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()).replace(/\D/g, "");
const pay = (o) => call(null)("POST", `/payments/confirmation/${token}`, { TransID: o.id ?? `T${randomUUID().slice(0, 9).toUpperCase()}`, TransTime: t, TransAmount: String(o.amount ?? 1000), BusinessShortCode: "600000", BillRefNumber: o.ref ?? "", MSISDN: o.phone ?? "254700000000", FirstName: "TEST" });
const validate = (ref) => call(null)("POST", `/payments/validation/${token}`, { TransID: `V${randomUUID().slice(0, 8)}`, TransTime: t, TransAmount: "500", BusinessShortCode: "600000", BillRefNumber: ref, MSISDN: "254700000001" });
// Matching runs as a background job: wait until the payment leaves "received" (max ~15 s).
const incoming = async (txn) => {
  for (let i = 0; i < 30; i++) {
    const p = (await admin("GET", `/payments/incoming?search=${txn}`)).data.find((x) => x.providerTxnId === txn);
    if (!p || p.status !== "received") { if (p || i > 4) return p; }
    await new Promise((r) => setTimeout(r, 500));
  }
  return (await admin("GET", `/payments/incoming?search=${txn}`)).data.find((x) => x.providerTxnId === txn);
};
const balance = async (studentId) => Number((await admin("GET", `/finance/students/${studentId}/history`)).data?.balance ?? NaN);

// 1. exact admission number
let id = `EX${run}1`; let r = await pay({ id, ref: single, amount: 500 });
let p = await incoming(id); check("1. Exact admission number posts automatically", r.status === 200 && p?.status === "matched", `http ${r.status}, ${p?.status}`);
// 2. normalised reference
id = `EX${run}2`; r = await pay({ id, ref: `adm 0${single}`, amount: 300 });
p = await incoming(id); check("2. 'adm 0NNN' normalises and posts", r.status === 200 && p?.status === "matched", `http ${r.status}, ${p?.status}`);
// 3. validation rejects unknown admission number
r = await validate("ZZ99999"); check("3. Unknown admission number rejected at validation", r.data?.ResultCode === "C2B00012", JSON.stringify(r.data));
// 5. blank reference, guardian with one child
id = `EX${run}5`; r = await pay({ id, ref: "", phone: ph1, amount: 200 });
p = await incoming(id); check("5. Blank reference, one-child guardian posts automatically", r.status === 200 && p?.status === "matched", `http ${r.status}, ${p?.status}`);
// 6. blank reference, guardian with three children -> queue
id = `EX${run}6`; r = await pay({ id, ref: "", phone: ph2, amount: 900 });
p = await incoming(id); check("6. Blank reference, three-child guardian goes to Unmatched", r.status === 200 && !!p && p.status !== "matched", `http ${r.status}, ${p?.status ?? "not stored"}${r.status !== 200 ? ` ${JSON.stringify(r.data).slice(0, 120)}` : ""}`);
// 8. typo -> queue
id = `EX${run}8`; r = await pay({ id, ref: `${single}9`, phone: "254700000123", amount: 100 });
p = await incoming(id); check("8. One-digit typo goes to Unmatched", r.status === 200 && !!p && p.status !== "matched", `http ${r.status}, ${p?.status ?? "not stored"}`);
// 9. unknown phone/ref -> queue -> bursar assigns -> next auto-posts
const stranger = `2547${String(Date.now()).slice(-8)}`;
id = `EX${run}9`; r = await pay({ id, ref: "", phone: stranger, amount: 250 });
p = await incoming(id);
const queued = r.status === 200 && !!p && p.status !== "matched";
let learned = false;
if (queued) {
  const q = (await bursar("GET", "/reconciliation/queue")).data.find((e) => e.paymentId === p.id);
  const res = q && await bursar("POST", `/reconciliation/queue/${q.id}/resolve`, { action: "assign", allocations: [{ studentId: sid(single), amount: "250" }], reason: "Parent confirmed by phone", learnAlias: true });
  const id2 = `EX${run}9B`; await pay({ id: id2, ref: "", phone: stranger, amount: 150 });
  learned = res?.status < 300 && (await incoming(id2))?.status === "matched";
}
check("9. Unknown payer queued; after assigning, next payment auto-posts", queued && learned, `http ${r.status}, ${p?.status ?? "not stored"}, learned=${learned}`);
// 10. duplicate confirmation
id = `EX${run}10`; await pay({ id, ref: single, amount: 50 }); r = await pay({ id, ref: single, amount: 50 });
const dups = (await admin("GET", `/payments/incoming?search=${id}`)).data.filter((x) => x.providerTxnId === id).length;
check("10. Same confirmation twice records one payment", r.status === 200 && dups === 1, `copies ${dups}`);
// 12. overpayment -> credit (below the high-value hold)
const before = await balance(sid(fam[0]));
id = `EX${run}12`; r = await pay({ id, ref: fam[0], amount: 60000 });
p = await incoming(id);
const after = await balance(sid(fam[0]));
check("12. Overpayment becomes credit", r.status === 200 && p?.status === "matched" && after < 0, `http ${r.status}, ${p?.status}, balance ${before} -> ${after}`);
// High value: stored and held for the bursar, never refused or auto-posted
id = `EX${run}HV`; r = await pay({ id, ref: fam[1], amount: 150000 });
p = await incoming(id);
const held = (await bursar("GET", "/reconciliation/queue")).data.find((e) => e.paymentId === p?.id);
check("High-value payment is stored and held for verification", r.status === 200 && p?.status === "unmatched" && held?.reason === "verification_required", `http ${r.status}, ${p?.status ?? "not stored"}, ${held?.reason}`);

const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
