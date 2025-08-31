// models/Report.js
const mongoose = require("mongoose");

// Flexible 84-key objects (q1..q84) stored as Number
const q84 = {};
for (let i = 1; i <= 84; i++) q84[`q${i}`] = { type: Number, default: 0 };

const ReportSchema = new mongoose.Schema(
  {
    district: { type: String, required: true, index: true },
    institution: { type: String, required: true, index: true },
    month: { type: String, required: true, index: true },   // e.g., "April"
    year: { type: String, required: true, index: true },    // store as string, e.g., "2025"

    // answers/cumulative are 84-number objects: { q1: 0, ... q84: 0 }
    answers: { type: new mongoose.Schema(q84, { _id: false }), default: () => ({}) },
    cumulative: { type: new mongoose.Schema(q84, { _id: false }), default: () => ({}) },

    // keep these loose; adjust if you want stricter typing later
    eyeBank: { type: Array, default: [] },
    visionCenter: { type: Array, default: [] },

    updatedAt: { type: Date, default: Date.now }
  },
  { timestamps: true, collection: "reports" }
);

// Helpful compound index for upsert lookups
ReportSchema.index({ district: 1, institution: 1, month: 1, year: 1 }, { unique: false });

module.exports = mongoose.models.Report || mongoose.model("Report", ReportSchema);

