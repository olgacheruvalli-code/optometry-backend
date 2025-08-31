// optometry-backend/server.js
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const { PrismaClient } = require('@prisma/client')

const app = express()
const prisma = new PrismaClient()

app.use(cors())
app.use(bodyParser.json())

// GET all reports
// GET reports with optional filters
app.get('/api/reports', async (req, res) => {
  try {
    const { district, institution, month, year } = req.query;

    const reports = await prisma.report.findMany({
      where: {
        ...(district && { district }),
        ...(institution && { institution }),
        ...(month && { month }),
        ...(year && { year }),
      },
    });

    // ensure eyeBank & visionCenter are always arrays
    const normalized = reports.map(r => ({
      ...r,
      eyeBank: r.eyeBank || [],
      visionCenter: r.visionCenter || []
    }));

    res.json(normalized);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// PUT update existing report by ID
app.put('/api/reports/:id', async (req, res) => {
  try {
    const {
      district,
      institution,
      month,
      year,
      answers,
      cumulative,
      eyeBank,
      visionCenter
    } = req.body;

    const updated = await prisma.report.update({
      where: { id: req.params.id },
      data: {
        district,
        institution,
        month,
        year,
        answers,
        cumulative,
        eyeBank,
        visionCenter
      }
    });

    res.json(updated);
  } catch (err) {
    console.error('❌ Failed to update report:', err);
    res.status(500).json({ error: 'Failed to update report.' });
  }
});
// POST a new report
app.post('/api/reports', async (req, res) => {
  try {
    const {
      district,
      institution,
      month,
      year,
      answers,
      cumulative,
      eyeBank = [],
      visionCenter = []
    } = req.body

    const report = await prisma.report.create({
      data: {
        district,
        institution,
        month,
        year,
        answers,
        cumulative,
        eyeBank,
        visionCenter
      }
    })

    res.json(report)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to save report' })
  }
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`)
})
