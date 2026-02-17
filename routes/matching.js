const express = require('express');
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
    if (error && error.code === 'ER_BAD_FIELD_ERROR') {
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

module.exports = router;
