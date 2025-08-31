// repair.js — normalize reports (answers/cumulative to {q1..q84}, etc.)

const mongoose = require("mongoose");
const Report = require("./models/Report");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/optometry";

const KEY_COUNT = 84;
const KEYS = Array.from({ length: KEY_COUNT }, (_, i) => `q${i + 1}`);

const FY_MONTHS = [
  "April","May","June","July","August","September",
  "October","November","December","January","February","March"
];

function clean(s){ return String(s || "").trim().replace(/\s+/g, " "); }

function toObj84(src){
  const out = {};
  if (Array.isArray(src)) {
    for (let i = 0; i < KEY_COUNT; i++) out[KEYS[i]] = Number(src[i] || 0);
    return out;
  }
  if (src && typeof src === "object") {
    for (let i = 0; i < KEY_COUNT; i++) out[KEYS[i]] = Number(src[KEYS[i]] || 0);
    return out;
  }
  for (let i = 0; i < KEY_COUNT; i++) out[KEYS[i]] = 0;
  return out;
}

function canonicalMonth(m) {
  const s = clean(m).toLowerCase();
  if (!s) return "";
  // Accept "April", "Apr", "4", "04"
  let idx = FY_MONTHS.findIndex(x => x.toLowerCase() === s || x.toLowerCase().startsWith(s));
  if (idx === -1 && /^\d{1,2}$/.test(s)) {
    const n = Number(s); // 1..12 as calendar
    if (n >= 1 && n <= 12) idx = (n + 2) % 12; // Apr(4)->0 ... Mar(3)->11
  }
  return idx >= 0 ? FY_MONTHS[idx] : m; // if unknown, keep original
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") out.all = true;
    else if (a === "--district") out.district = argv[++i];
    else if (a === "--institution") out.institution = argv[++i];
    else if (a === "--month") out.month = argv[++i];
    else if (a === "--year") out.year = argv[++i];
    else if (a === "--uri") out.uri = argv[++i];
  }
  return out;
}

async function normalizeDoc(doc) {
  let changed = false;

  // normalize answers
  const normAnswers = toObj84(doc.answers);
  if (JSON.stringify(normAnswers) !== JSON.stringify(doc.answers)) {
    doc.answers = normAnswers;
    changed = true;
  }

  // normalize cumulative
  const normCum = toObj84(doc.cumulative);
  if (JSON.stringify(normCum) !== JSON.stringify(doc.cumulative)) {
    doc.cumulative = normCum;
    changed = true;
  }

  // ensure arrays
  if (!Array.isArray(doc.eyeBank))  { doc.eyeBank = []; changed = true; }
  if (!Array.isArray(doc.visionCenter)) { doc.visionCenter = []; changed = true; }

  // canonical month label
  const canon = canonicalMonth(doc.month);
  if (canon && canon !== doc.month) {
    doc.month = canon;
    changed = true;
  }

  if (changed) {
    doc.updatedAt = new Date();
    await doc.save();
  }
  return changed;
}

async function main() {
  const opts = parseArgs(process.argv);
  const uri = opts.uri || MONGO_URI;

  console.log("🔧 Connecting:", uri);
  await mongoose.connect(uri, { dbName: "optometry" });

  const q = {};
  if (!opts.all) {
    if (opts.district)    q.district    = new RegExp(`^${clean(opts.district)}$`, "i");
    if (opts.institution) q.institution = new RegExp(`^${clean(opts.institution)}$`, "i");
    if (opts.month)       q.month       = new RegExp(`^${clean(opts.month)}`, "i");
    if (opts.year)        q.year        = String(opts.year);
  }

  const total = await Report.countDocuments(q);
  console.log(`🔎 Matching documents: ${total}`);
  if (!total) {
    await mongoose.disconnect();
    return;
  }

  const cursor = Report.find(q).cursor();
  let seen = 0, patched = 0;
  for (let doc = await cursor.next(); doc; doc = await cursor.next()) {
    seen++;
    const changed = await normalizeDoc(doc);
    if (changed) patched++;
    if (seen % 50 === 0) console.log(`… processed ${seen} (${patched} updated)`);
  }

  console.log(`✅ Done. Processed: ${seen}, Updated: ${patched}`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error("❌ repair failed:", err);
  process.exit(1);
});

