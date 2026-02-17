const EARTH_RADIUS_KM = 6371;

const toRadians = degrees => (degrees * Math.PI) / 180;

const roundCoordinate = value => Number.parseFloat(value.toFixed(7));

const parseCoordinate = (value, { min, max, fieldName, required = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) {
      return { value: null, error: `${fieldName} is required` };
    }
    return { value: null, error: null };
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return { value: null, error: `${fieldName} must be a valid number` };
  }

  if (parsed < min || parsed > max) {
    return { value: null, error: `${fieldName} must be between ${min} and ${max}` };
  }

  return { value: roundCoordinate(parsed), error: null };
};

const parseLatitude = (value, required = false) => parseCoordinate(value, {
  min: -90,
  max: 90,
  fieldName: 'latitude',
  required
});

const parseLongitude = (value, required = false) => parseCoordinate(value, {
  min: -180,
  max: 180,
  fieldName: 'longitude',
  required
});

const haversineDistanceKm = (lat1, lon1, lat2, lon2) => {
  const latDistance = toRadians(lat2 - lat1);
  const lonDistance = toRadians(lon2 - lon1);

  const a =
    Math.sin(latDistance / 2) * Math.sin(latDistance / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(lonDistance / 2) * Math.sin(lonDistance / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
};

module.exports = {
  haversineDistanceKm,
  parseLatitude,
  parseLongitude
};
