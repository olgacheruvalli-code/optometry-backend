const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

/**
 * DELETE /api/admin/wipe-reports
 * Query:
 *   all=true   -> delete ALL reports (dangerous)
 *   OR any combination: district=...&month=...&year=...
 *
 * Header:
 *   x-admin-token: <ADMIN_TOKEN>
 */
router.delete('/wipe-reports', async (req, res) => {
  try {
    const token = req.header('x-admin-token');
    if (!token || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const { district, month, year, all } = req.query;
    let filter = {};
    if (all === 'true') {
      // wipe everything
    } else {
      if (district) filter.district = district;
      if (month) filter.month = month;
      if (year) filter.year = String(year);
      if (!Object.keys(filter).length) {
        return res.status(400).json({ ok: false, error: 'Provide filters (district/month/year) or all=true' });
      }
    }

    const col = mongoose.connection.collection('reports');
    const result = await col.deleteMany(filter);
    res.json({ ok: true, deletedCount: result?.deletedCount ?? 0, filter });
  } catch (e) {
    console.error('wipe-reports failed', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

module.exports = router;
