const { pool } = require('../config/database');
const { haversineDistanceKm } = require('./geo');

const BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);

const parsePositiveFloat = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeBloodGroup = value => (typeof value === 'string' ? value.trim().toUpperCase() : '');

const findNearbyDonors = async ({
  bloodGroup,
  latitude,
  longitude,
  radiusKm = 10,
  limit = 50
}) => {
  const normalizedBloodGroup = normalizeBloodGroup(bloodGroup);
  if (!BLOOD_GROUPS.has(normalizedBloodGroup)) {
    return {
      donors: [],
      candidateCount: 0,
      error: 'Invalid blood group'
    };
  }

  const normalizedRadiusKm = parsePositiveFloat(radiusKm, 10);
  const normalizedLimit = parsePositiveInt(limit, 50);

  const [donors] = await pool.execute(
    `SELECT id, name, email, phone, blood_group, location, city, state, latitude, longitude, last_donation_date
     FROM users
     WHERE is_donor = TRUE
       AND blood_group = ?
       AND latitude IS NOT NULL
       AND longitude IS NOT NULL
       AND (last_donation_date IS NULL OR last_donation_date <= DATE_SUB(CURDATE(), INTERVAL 90 DAY))`,
    [normalizedBloodGroup]
  );

  const withDistance = donors
    .map(donor => {
      const donorLatitude = Number.parseFloat(donor.latitude);
      const donorLongitude = Number.parseFloat(donor.longitude);
      const distanceKm = haversineDistanceKm(
        latitude,
        longitude,
        donorLatitude,
        donorLongitude
      );

      return {
        ...donor,
        distance_km: Number.parseFloat(distanceKm.toFixed(2))
      };
    })
    .filter(donor => donor.distance_km <= normalizedRadiusKm)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, normalizedLimit);

  return {
    donors: withDistance,
    candidateCount: donors.length,
    radiusKm: normalizedRadiusKm
  };
};

module.exports = {
  BLOOD_GROUPS,
  findNearbyDonors
};
