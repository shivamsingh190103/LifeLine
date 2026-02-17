const express = require('express');
const { pool } = require('../config/database');
const alertStream = require('../services/alertStream');
const { parseLatitude, parseLongitude, haversineDistanceKm } = require('../services/geo');
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

const resolveAlertContext = async ({ userId, bloodGroupInput, latitudeInput, longitudeInput }) => {
  let bloodGroup = normalizeBloodGroup(bloodGroupInput);
  let latitudeValue = latitudeInput;
  let longitudeValue = longitudeInput;

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
        if (latitudeValue === undefined || latitudeValue === null || latitudeValue === '') {
          latitudeValue = user.latitude;
        }
        if (longitudeValue === undefined || longitudeValue === null || longitudeValue === '') {
          longitudeValue = user.longitude;
        }
      }
    } catch (error) {
      if (error.code !== 'ER_BAD_FIELD_ERROR' && error.code !== '42703') {
        throw error;
      }
    }
  }

  const { value: latitude, error: latitudeError } = parseLatitude(latitudeValue, false);
  const { value: longitude, error: longitudeError } = parseLongitude(longitudeValue, false);
  if (latitudeError || longitudeError) {
    return {
      error: latitudeError || longitudeError
    };
  }

  if (bloodGroup && !BLOOD_GROUPS.has(bloodGroup)) {
    return {
      error: 'Invalid blood group'
    };
  }

  return {
    userId,
    bloodGroup,
    latitude,
    longitude,
    error: null
  };
};

router.get('/stream', async (req, res) => {
  try {
    const userId = parsePositiveInt(req.query.userId);
    const context = await resolveAlertContext({
      userId,
      bloodGroupInput: req.query.bloodGroup || req.query.blood_group,
      latitudeInput: req.query.latitude,
      longitudeInput: req.query.longitude
    });

    if (context.error) {
      return res.status(400).json({
        success: false,
        message: context.error
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
      userId: context.userId,
      bloodGroup: context.bloodGroup,
      latitude: context.latitude,
      longitude: context.longitude,
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

router.get('/recent', async (req, res) => {
  try {
    const userId = parsePositiveInt(req.query.userId);
    const context = await resolveAlertContext({
      userId,
      bloodGroupInput: req.query.bloodGroup || req.query.blood_group,
      latitudeInput: req.query.latitude,
      longitudeInput: req.query.longitude
    });

    if (context.error) {
      return res.status(400).json({
        success: false,
        message: context.error
      });
    }

    const radiusKm = Math.min(parsePositiveFloat(req.query.radiusKm || req.query.radius_km, 5), 50);
    const requestedLimit = parsePositiveInt(req.query.limit);
    const limit = requestedLimit ? Math.min(requestedLimit, 20) : 10;
    const canMeasureDistance = context.latitude !== null && context.longitude !== null;

    const whereParts = [
      `br.status = 'Pending'`,
      `br.urgency_level IN ('High', 'Emergency')`
    ];
    const params = [];

    if (context.bloodGroup) {
      whereParts.push('br.blood_group = ?');
      params.push(context.bloodGroup);
    }

    params.push(limit * 4);

    const [requests] = await pool.execute(
      `SELECT
         br.id AS request_id,
         br.patient_name,
         br.blood_group,
         br.urgency_level,
         br.units_required,
         br.hospital_name,
         br.created_at,
         u.latitude AS requester_latitude,
         u.longitude AS requester_longitude
       FROM blood_requests br
       LEFT JOIN users u ON br.requester_id = u.id
       WHERE ${whereParts.join(' AND ')}
       ORDER BY br.created_at DESC
       LIMIT ?`,
      params
    );

    const alerts = [];
    for (const row of requests) {
      let distanceKm = null;
      if (canMeasureDistance) {
        const requesterLat = Number.parseFloat(row.requester_latitude);
        const requesterLng = Number.parseFloat(row.requester_longitude);

        if (!Number.isFinite(requesterLat) || !Number.isFinite(requesterLng)) {
          continue;
        }

        distanceKm = haversineDistanceKm(
          context.latitude,
          context.longitude,
          requesterLat,
          requesterLng
        );

        if (distanceKm > radiusKm) {
          continue;
        }
      }

      alerts.push({
        request_id: row.request_id,
        patient_name: row.patient_name,
        blood_group: row.blood_group,
        urgency_level: row.urgency_level,
        units_required: row.units_required,
        hospital_name: row.hospital_name,
        created_at: row.created_at,
        distance_km: Number.isFinite(distanceKm) ? Number.parseFloat(distanceKm.toFixed(2)) : null
      });

      if (alerts.length >= limit) {
        break;
      }
    }

    return res.json({
      success: true,
      alerts
    });
  } catch (error) {
    console.error('Load recent alerts error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load recent alerts'
    });
  }
});

router.get('/stats', (req, res) => {
  res.json({
    success: true,
    ...alertStream.getStats()
  });
});

module.exports = router;
