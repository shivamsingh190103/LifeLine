const express = require('express');
const { pool } = require('../config/database');
const cacheService = require('../services/cache');
const { findNearbyDonors, BLOOD_GROUPS } = require('../services/donorMatcher');
const { parseLatitude, parseLongitude } = require('../services/geo');

const router = express.Router();

const parsePositiveFloat = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeBloodGroup = value => (typeof value === 'string' ? value.trim().toUpperCase() : '');
const normalizeString = value => (typeof value === 'string' ? value.trim() : '');

router.get('/nearby-donors', async (req, res) => {
  try {
    const bloodGroup = normalizeBloodGroup(req.query.bloodGroup || req.query.blood_group);
    if (!BLOOD_GROUPS.has(bloodGroup)) {
      return res.status(400).json({
        success: false,
        message: 'Valid bloodGroup is required'
      });
    }

    const { value: latitude, error: latitudeError } = parseLatitude(req.query.latitude, true);
    const { value: longitude, error: longitudeError } = parseLongitude(req.query.longitude, true);
    if (latitudeError || longitudeError) {
      return res.status(400).json({
        success: false,
        message: latitudeError || longitudeError
      });
    }

    const radiusKm = parsePositiveFloat(req.query.radiusKm || req.query.radius_km, 10);
    const limit = parsePositiveInt(req.query.limit, 50);
    const cacheTtlSeconds = parsePositiveInt(process.env.DONOR_SEARCH_CACHE_TTL_SECONDS, 120);
    const cacheKey = [
      'matching:nearby',
      bloodGroup,
      latitude.toFixed(4),
      longitude.toFixed(4),
      radiusKm.toFixed(2),
      limit
    ].join(':');

    const start = Date.now();
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return res.json({
        ...cached,
        metadata: {
          ...cached.metadata,
          cacheHit: true,
          responseMs: Date.now() - start
        }
      });
    }

    const result = await findNearbyDonors({
      bloodGroup,
      latitude,
      longitude,
      radiusKm,
      limit
    });

    if (result.error) {
      return res.status(400).json({
        success: false,
        message: result.error
      });
    }

    const payload = {
      success: true,
      blood_group: bloodGroup,
      donors: result.donors,
      metadata: {
        cacheHit: false,
        totalMatched: result.donors.length,
        candidateCount: result.candidateCount,
        radiusKm: result.radiusKm
      }
    };

    await cacheService.set(cacheKey, payload, cacheTtlSeconds);

    return res.json({
      ...payload,
      metadata: {
        ...payload.metadata,
        responseMs: Date.now() - start
      }
    });
  } catch (error) {
    console.error('Nearby donor matching error:', error);
    if (error && (error.code === 'ER_BAD_FIELD_ERROR' || error.code === '42703')) {
      return res.status(500).json({
        success: false,
        message: 'Database schema is outdated. Run `npm run setup` to enable geospatial matching.'
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Failed to match nearby donors'
    });
  }
});

router.get('/cache/stats', async (req, res) => {
  try {
    return res.json({
      success: true,
      stats: cacheService.stats()
    });
  } catch (error) {
    console.error('Cache stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get cache statistics'
    });
  }
});

router.get('/donors-by-location', async (req, res) => {
  try {
    const locationQuery = normalizeString(req.query.location || req.query.q);
    const bloodGroup = normalizeBloodGroup(req.query.bloodGroup || req.query.blood_group);
    const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);

    if (!locationQuery) {
      return res.status(400).json({
        success: false,
        message: 'location query is required'
      });
    }

    if (bloodGroup && !BLOOD_GROUPS.has(bloodGroup)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blood group'
      });
    }

    const params = [
      `%${locationQuery}%`,
      `%${locationQuery}%`,
      `%${locationQuery}%`
    ];

    let query = `
      SELECT id, name, email, phone, blood_group, location, city, state, last_donation_date
      FROM users
      WHERE is_donor = TRUE
        AND (COALESCE(location, '') ILIKE ?
          OR COALESCE(city, '') ILIKE ?
          OR COALESCE(state, '') ILIKE ?)
        AND (last_donation_date IS NULL OR last_donation_date <= (CURRENT_DATE - INTERVAL '90 days'))
    `;

    if (bloodGroup) {
      query += ' AND blood_group = ?';
      params.push(bloodGroup);
    }

    query += ' ORDER BY updated_at DESC, created_at DESC LIMIT ?';
    params.push(limit);

    const [donors] = await pool.execute(query, params);

    return res.json({
      success: true,
      filters: {
        location: locationQuery,
        blood_group: bloodGroup || null
      },
      donors
    });
  } catch (error) {
    console.error('Donor-by-location search error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to search donors by location'
    });
  }
});

router.get('/receivers-by-location', async (req, res) => {
  try {
    const locationQuery = normalizeString(req.query.location || req.query.q);
    const bloodGroup = normalizeBloodGroup(req.query.bloodGroup || req.query.blood_group);
    const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);

    if (!locationQuery) {
      return res.status(400).json({
        success: false,
        message: 'location query is required'
      });
    }

    if (bloodGroup && !BLOOD_GROUPS.has(bloodGroup)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blood group'
      });
    }

    const params = [
      `%${locationQuery}%`,
      `%${locationQuery}%`,
      `%${locationQuery}%`,
      `%${locationQuery}%`,
      `%${locationQuery}%`
    ];

    let query = `
      SELECT br.id, br.patient_name, br.blood_group, br.units_required, br.hospital_name, br.hospital_address,
             br.urgency_level, br.contact_person, br.contact_phone, br.required_date, br.status, br.created_at,
             u.id AS requester_id, u.name AS requester_name, u.phone AS requester_phone,
             u.location AS requester_location, u.city AS requester_city, u.state AS requester_state
      FROM blood_requests br
      LEFT JOIN users u ON br.requester_id = u.id
      WHERE br.status IN ('Pending', 'In Progress')
        AND (COALESCE(br.hospital_name, '') ILIKE ?
          OR COALESCE(br.hospital_address, '') ILIKE ?
          OR COALESCE(u.location, '') ILIKE ?
          OR COALESCE(u.city, '') ILIKE ?
          OR COALESCE(u.state, '') ILIKE ?)
    `;

    if (bloodGroup) {
      query += ' AND br.blood_group = ?';
      params.push(bloodGroup);
    }

    query += `
      ORDER BY
        CASE br.urgency_level
          WHEN 'Emergency' THEN 1
          WHEN 'High' THEN 2
          WHEN 'Medium' THEN 3
          ELSE 4
        END,
        br.created_at DESC
      LIMIT ?
    `;
    params.push(limit);

    const [receivers] = await pool.execute(query, params);

    return res.json({
      success: true,
      filters: {
        location: locationQuery,
        blood_group: bloodGroup || null
      },
      receivers
    });
  } catch (error) {
    console.error('Receiver-by-location search error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to search receivers by location'
    });
  }
});

module.exports = router;
