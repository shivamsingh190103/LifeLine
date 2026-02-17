const express = require('express');
const { pool } = require('../config/database');
const alertStream = require('../services/alertStream');
const { parseLatitude, parseLongitude } = require('../services/geo');
const { BLOOD_GROUPS } = require('../services/donorMatcher');

const router = express.Router();

const parsePositiveInt = value => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parsePositiveFloat = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeBloodGroup = value => (typeof value === 'string' ? value.trim().toUpperCase() : '');

router.get('/stream', async (req, res) => {
  try {
    const userId = parsePositiveInt(req.query.userId);
    let bloodGroup = normalizeBloodGroup(req.query.bloodGroup || req.query.blood_group);
    let latitudeInput = req.query.latitude;
    let longitudeInput = req.query.longitude;

    if (userId) {
      try {
        const [users] = await pool.execute(
          'SELECT blood_group, latitude, longitude FROM users WHERE id = ?',
          [userId]
        );

        if (users.length > 0) {
          const user = users[0];
          if (!bloodGroup) {
            bloodGroup = user.blood_group;
          }
          if (latitudeInput === undefined || latitudeInput === null || latitudeInput === '') {
            latitudeInput = user.latitude;
          }
          if (longitudeInput === undefined || longitudeInput === null || longitudeInput === '') {
            longitudeInput = user.longitude;
          }
        }
      } catch (error) {
        if (error.code !== 'ER_BAD_FIELD_ERROR') {
          throw error;
        }
      }
    }

    const { value: latitude, error: latitudeError } = parseLatitude(latitudeInput, false);
    const { value: longitude, error: longitudeError } = parseLongitude(longitudeInput, false);
    if (latitudeError || longitudeError) {
      return res.status(400).json({
        success: false,
        message: latitudeError || longitudeError
      });
    }

    if (bloodGroup && !BLOOD_GROUPS.has(bloodGroup)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blood group'
      });
    }

    const radiusKm = parsePositiveFloat(req.query.radiusKm || req.query.radius_km, 5);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (res.flushHeaders) {
      res.flushHeaders();
    }

    const clientId = alertStream.addClient(res, {
      userId,
      bloodGroup,
      latitude,
      longitude,
      radiusKm
    });

    req.on('close', () => {
      alertStream.removeClient(clientId);
    });
  } catch (error) {
    console.error('SSE stream setup error:', error);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: 'Failed to start alerts stream'
      });
    }
    return res.end();
  }
});

router.get('/stats', (req, res) => {
  res.json({
    success: true,
    ...alertStream.getStats()
  });
});

module.exports = router;
