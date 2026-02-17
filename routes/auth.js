const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { parseLatitude, parseLongitude } = require('../services/geo');

const router = express.Router();

const BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parsePositiveInt = (value, fallback = null) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const createIpRateLimiter = ({ windowMs, max, message }) => {
  const buckets = new Map();
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }, Math.max(windowMs, 60000));

  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return (req, res, next) => {
    const forwarded = req.headers['x-forwarded-for'];
    const clientIp = typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : (req.ip || req.connection.remoteAddress || 'unknown');

    const now = Date.now();
    let bucket = buckets.get(clientIp);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
    }

    bucket.count += 1;
    buckets.set(clientIp, bucket);

    const remaining = Math.max(max - bucket.count, 0);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      return res.status(429).json({
        success: false,
        message
      });
    }

    return next();
  };
};

const normalizeString = value => (typeof value === 'string' ? value.trim() : '');

const optionalStringOrNull = value => {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = normalizeString(value);
  return normalized || null;
};

const optionalUpdateString = value => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const normalized = normalizeString(value);
  return normalized || null;
};

const normalizeBoolean = value => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 1 || value === '1' || value === 'true') {
    return true;
  }
  if (value === 0 || value === '0' || value === 'false') {
    return false;
  }
  return undefined;
};

const parseOptionalCoordinateUpdate = (value, parser) => {
  if (value === undefined) {
    return { value: undefined, error: null };
  }

  if (value === null || value === '') {
    return { value: null, error: null };
  }

  const { value: parsedValue, error } = parser(value, false);
  return { value: parsedValue, error };
};

const authLimiter = createIpRateLimiter({
  windowMs: parsePositiveInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  max: parsePositiveInt(process.env.AUTH_RATE_LIMIT_MAX, 30),
  message: 'Too many authentication attempts. Please try again later.'
});

const geoColumnsState = {
  checked: false,
  available: false
};

const hasUserGeoColumns = async () => {
  if (geoColumnsState.checked) {
    return geoColumnsState.available;
  }

  try {
    const [latitudeColumn] = await pool.query(`SHOW COLUMNS FROM users LIKE 'latitude'`);
    const [longitudeColumn] = await pool.query(`SHOW COLUMNS FROM users LIKE 'longitude'`);
    geoColumnsState.available = latitudeColumn.length > 0 && longitudeColumn.length > 0;
  } catch (error) {
    geoColumnsState.available = false;
  } finally {
    geoColumnsState.checked = true;
  }

  return geoColumnsState.available;
};

// User Registration
router.post('/register', authLimiter, async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phone = null,
      blood_group,
      location = null,
      city = null,
      state = null,
      latitude = null,
      longitude = null
    } = req.body;

    const normalizedName = normalizeString(name);
    const normalizedEmail = normalizeString(email).toLowerCase();
    const normalizedPassword = typeof password === 'string' ? password : '';
    const normalizedBloodGroup = normalizeString(blood_group).toUpperCase();
    const normalizedPhone = optionalStringOrNull(phone);
    const normalizedLocation = optionalStringOrNull(location);
    const normalizedCity = optionalStringOrNull(city);
    const normalizedState = optionalStringOrNull(state);
    const parsedLatitude = parseLatitude(latitude, false);
    const parsedLongitude = parseLongitude(longitude, false);

    if (parsedLatitude.error || parsedLongitude.error) {
      return res.status(400).json({
        success: false,
        message: parsedLatitude.error || parsedLongitude.error
      });
    }

    if (!normalizedName || !normalizedEmail || !normalizedPassword || !normalizedBloodGroup) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, password, and blood group are required'
      });
    }

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    if (normalizedPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    if (!BLOOD_GROUPS.has(normalizedBloodGroup)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blood group'
      });
    }

    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [normalizedEmail]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(normalizedPassword, saltRounds);
    const useGeoColumns = await hasUserGeoColumns();

    let result;
    if (useGeoColumns) {
      [result] = await pool.execute(
        `INSERT INTO users (
           name, email, password, phone, blood_group, location, city, state, latitude, longitude
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          normalizedName,
          normalizedEmail,
          hashedPassword,
          normalizedPhone,
          normalizedBloodGroup,
          normalizedLocation,
          normalizedCity,
          normalizedState,
          parsedLatitude.value,
          parsedLongitude.value
        ]
      );
    } else {
      [result] = await pool.execute(
        `INSERT INTO users (
           name, email, password, phone, blood_group, location, city, state
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          normalizedName,
          normalizedEmail,
          hashedPassword,
          normalizedPhone,
          normalizedBloodGroup,
          normalizedLocation,
          normalizedCity,
          normalizedState
        ]
      );
    }

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: result.insertId,
        name: normalizedName,
        email: normalizedEmail,
        blood_group: normalizedBloodGroup,
        location: normalizedLocation,
        latitude: useGeoColumns ? parsedLatitude.value : null,
        longitude: useGeoColumns ? parsedLongitude.value : null
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// User Login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const normalizedEmail = normalizeString(req.body.email).toLowerCase();
    const inputPassword = typeof req.body.password === 'string' ? req.body.password : '';

    if (!normalizedEmail || !inputPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    const useGeoColumns = await hasUserGeoColumns();
    const [users] = await pool.execute(
      `SELECT id, name, email, password, phone, blood_group, location, city, state,
              ${useGeoColumns ? 'latitude, longitude' : 'NULL as latitude, NULL as longitude'},
              is_donor, is_recipient, last_donation_date, created_at, updated_at
       FROM users
       WHERE email = ?`,
      [normalizedEmail]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = users[0];
    const isPasswordValid = await bcrypt.compare(inputPassword, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const { password: _password, ...safeUser } = user;

    return res.json({
      success: true,
      message: 'Login successful',
      user: safeUser
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get user profile
router.get('/profile/:id', async (req, res) => {
  try {
    const userId = parsePositiveInt(req.params.id);
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    const useGeoColumns = await hasUserGeoColumns();
    const [users] = await pool.execute(
      `SELECT id, name, email, phone, blood_group, location, city, state,
              ${useGeoColumns ? 'latitude, longitude' : 'NULL as latitude, NULL as longitude'},
              is_donor, is_recipient, last_donation_date, created_at
       FROM users WHERE id = ?`,
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.json({
      success: true,
      user: users[0]
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update user profile
router.put('/profile/:id', async (req, res) => {
  try {
    const userId = parsePositiveInt(req.params.id);
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    const {
      name,
      phone,
      location,
      city,
      state,
      latitude,
      longitude,
      is_donor,
      is_recipient
    } = req.body;

    const useGeoColumns = await hasUserGeoColumns();

    const parsedIsDonor = normalizeBoolean(is_donor);
    const parsedIsRecipient = normalizeBoolean(is_recipient);
    const parsedLatitude = parseOptionalCoordinateUpdate(latitude, parseLatitude);
    const parsedLongitude = parseOptionalCoordinateUpdate(longitude, parseLongitude);

    if (parsedLatitude.error || parsedLongitude.error) {
      return res.status(400).json({
        success: false,
        message: parsedLatitude.error || parsedLongitude.error
      });
    }

    if (!useGeoColumns && (latitude !== undefined || longitude !== undefined)) {
      return res.status(400).json({
        success: false,
        message: 'Database schema is outdated. Run `npm run setup` to enable location updates.'
      });
    }

    if (is_donor !== undefined && parsedIsDonor === undefined) {
      return res.status(400).json({
        success: false,
        message: 'is_donor must be a boolean'
      });
    }

    if (is_recipient !== undefined && parsedIsRecipient === undefined) {
      return res.status(400).json({
        success: false,
        message: 'is_recipient must be a boolean'
      });
    }

    const normalizedUpdates = {
      name: optionalUpdateString(name),
      phone: optionalUpdateString(phone),
      location: optionalUpdateString(location),
      city: optionalUpdateString(city),
      state: optionalUpdateString(state),
      latitude: parsedLatitude.value,
      longitude: parsedLongitude.value,
      is_donor: parsedIsDonor,
      is_recipient: parsedIsRecipient
    };

    const hasAnyUpdate = Object.values(normalizedUpdates).some(value => value !== undefined);
    if (!hasAnyUpdate) {
      return res.status(400).json({
        success: false,
        message: 'At least one field is required to update profile'
      });
    }

    let result;
    if (useGeoColumns) {
      [result] = await pool.execute(
        `UPDATE users SET
           name = COALESCE(?, name),
           phone = COALESCE(?, phone),
           location = COALESCE(?, location),
           city = COALESCE(?, city),
           state = COALESCE(?, state),
           latitude = COALESCE(?, latitude),
           longitude = COALESCE(?, longitude),
           is_donor = COALESCE(?, is_donor),
           is_recipient = COALESCE(?, is_recipient),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          normalizedUpdates.name ?? null,
          normalizedUpdates.phone ?? null,
          normalizedUpdates.location ?? null,
          normalizedUpdates.city ?? null,
          normalizedUpdates.state ?? null,
          normalizedUpdates.latitude ?? null,
          normalizedUpdates.longitude ?? null,
          normalizedUpdates.is_donor === undefined ? null : normalizedUpdates.is_donor,
          normalizedUpdates.is_recipient === undefined ? null : normalizedUpdates.is_recipient,
          userId
        ]
      );
    } else {
      [result] = await pool.execute(
        `UPDATE users SET
           name = COALESCE(?, name),
           phone = COALESCE(?, phone),
           location = COALESCE(?, location),
           city = COALESCE(?, city),
           state = COALESCE(?, state),
           is_donor = COALESCE(?, is_donor),
           is_recipient = COALESCE(?, is_recipient),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          normalizedUpdates.name ?? null,
          normalizedUpdates.phone ?? null,
          normalizedUpdates.location ?? null,
          normalizedUpdates.city ?? null,
          normalizedUpdates.state ?? null,
          normalizedUpdates.is_donor === undefined ? null : normalizedUpdates.is_donor,
          normalizedUpdates.is_recipient === undefined ? null : normalizedUpdates.is_recipient,
          userId
        ]
      );
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.json({
      success: true,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get all users (for admin/dashboard purposes)
router.get('/users', async (req, res) => {
  try {
    const useGeoColumns = await hasUserGeoColumns();
    const [users] = await pool.execute(
      `SELECT id, name, email, blood_group, location, city, state,
              ${useGeoColumns ? 'latitude, longitude' : 'NULL as latitude, NULL as longitude'},
              is_donor, is_recipient, last_donation_date
       FROM users
       ORDER BY created_at DESC`
    );

    return res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error('Get users error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
