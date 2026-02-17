const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { pool } = require('../config/database');
const { parseLatitude, parseLongitude } = require('../services/geo');

const router = express.Router();

const BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\d{10}$/;
const DEFAULT_DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com',
  'tempmail.com',
  '10minutemail.com',
  'guerrillamail.com',
  'yopmail.com',
  'trashmail.com',
  'sharklasers.com',
  'dispostable.com',
  'fakeinbox.com',
  'getnada.com'
]);

const parsePositiveInt = (value, fallback = null) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseBooleanEnv = value => {
  if (value === undefined || value === null) {
    return false;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const normalizePhoneDigits = value => {
  if (value === undefined || value === null) {
    return null;
  }

  const digits = String(value).replace(/\D/g, '');
  return digits || null;
};

const normalizePhoneDigitsUpdate = value => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  const digits = String(value).replace(/\D/g, '');
  return digits || null;
};

const isValidPhone = value => value === null || PHONE_REGEX.test(value);

const getDisposableDomains = () => {
  const configuredDomains = (process.env.DISPOSABLE_EMAIL_DOMAINS || '')
    .split(',')
    .map(domain => domain.trim().toLowerCase())
    .filter(Boolean);

  return new Set([...DEFAULT_DISPOSABLE_EMAIL_DOMAINS, ...configuredDomains]);
};

const isDisposableEmailDomain = email => {
  const parts = email.split('@');
  if (parts.length !== 2) {
    return false;
  }

  const domain = parts[1].toLowerCase();
  const disposableDomains = getDisposableDomains();

  if (disposableDomains.has(domain)) {
    return true;
  }

  return domain.endsWith('.mailinator.com');
};

const isLocalHost = host => {
  if (!host) {
    return false;
  }
  return host.includes('localhost') || host.includes('127.0.0.1');
};

const getRequestBaseUrl = req => {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req.get('host');
  return `${protocol}://${host}`;
};

const getAppBaseUrl = req => {
  const configuredBaseUrl = (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  const requestBaseUrl = getRequestBaseUrl(req).replace(/\/+$/, '');

  if (!configuredBaseUrl) {
    return requestBaseUrl;
  }

  const configuredHost = (() => {
    try {
      return new URL(configuredBaseUrl).host;
    } catch (error) {
      return '';
    }
  })();
  const requestHost = (() => {
    try {
      return new URL(requestBaseUrl).host;
    } catch (error) {
      return '';
    }
  })();

  // If APP_BASE_URL is left as localhost but traffic is from deployed domain,
  // prefer request host so reset/verify links continue to work in production.
  if (isLocalHost(configuredHost) && requestHost && !isLocalHost(requestHost)) {
    return requestBaseUrl;
  }

  return configuredBaseUrl;
};

let emailTransporter = null;

const isMailConfigured = () => (
  Boolean(process.env.SMTP_HOST) &&
  Boolean(process.env.SMTP_USER) &&
  Boolean(process.env.SMTP_PASS) &&
  Boolean(process.env.SMTP_FROM)
);

const getMailTransporter = () => {
  if (!isMailConfigured()) {
    return null;
  }

  if (emailTransporter) {
    return emailTransporter;
  }

  const smtpPort = Number.parseInt(process.env.SMTP_PORT, 10);
  const port = Number.isInteger(smtpPort) && smtpPort > 0 ? smtpPort : 587;
  const secure = parseBooleanEnv(process.env.SMTP_SECURE) || port === 465;

  emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  return emailTransporter;
};

const sendPasswordResetEmail = async ({ to, name, resetLink }) => {
  const transporter = getMailTransporter();
  if (!transporter) {
    throw new Error('SMTP is not configured');
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: 'BloodBank password reset',
    text: `Hi ${name || 'there'},\n\nUse this link to reset your password:\n${resetLink}\n\nThis link expires soon. If you did not request this, ignore this email.`,
    html: `
      <p>Hi ${name || 'there'},</p>
      <p>Use this link to reset your BloodBank password:</p>
      <p><a href="${resetLink}">${resetLink}</a></p>
      <p>This link expires soon. If you did not request this, you can ignore this email.</p>
    `
  });
};

const sendEmailVerificationEmail = async ({ to, name, verifyLink }) => {
  const transporter = getMailTransporter();
  if (!transporter) {
    throw new Error('SMTP is not configured');
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: 'Verify your BloodBank email',
    text: `Hi ${name || 'there'},\n\nPlease verify your email by opening this link:\n${verifyLink}\n\nIf you did not create this account, you can ignore this email.`,
    html: `
      <p>Hi ${name || 'there'},</p>
      <p>Please verify your BloodBank email by clicking this link:</p>
      <p><a href="${verifyLink}">${verifyLink}</a></p>
      <p>If you did not create this account, you can ignore this email.</p>
    `
  });
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
const passwordResetTtlMinutes = parsePositiveInt(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES, 30);
const emailVerificationTtlHours = parsePositiveInt(process.env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS, 24);

const geoColumnsState = {
  checked: false,
  available: false
};
const emailVerifiedColumnState = {
  checked: false,
  available: false
};

const hasUserGeoColumns = async () => {
  if (geoColumnsState.checked) {
    return geoColumnsState.available;
  }

  try {
    const [columns] = await pool.execute(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'users'
         AND column_name IN ('latitude', 'longitude')`
    );
    const columnNames = new Set(columns.map(column => column.column_name));
    geoColumnsState.available = columnNames.has('latitude') && columnNames.has('longitude');
  } catch (error) {
    geoColumnsState.available = false;
  } finally {
    geoColumnsState.checked = true;
  }

  return geoColumnsState.available;
};

const hasEmailVerifiedColumn = async () => {
  if (emailVerifiedColumnState.checked) {
    return emailVerifiedColumnState.available;
  }

  try {
    const [columns] = await pool.execute(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'users'
         AND column_name = 'email_verified'`
    );
    emailVerifiedColumnState.available = columns.length > 0;
  } catch (error) {
    emailVerifiedColumnState.available = false;
  } finally {
    emailVerifiedColumnState.checked = true;
  }

  return emailVerifiedColumnState.available;
};

const createEmailVerificationToken = async ({ userId, email, name, req }) => {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + emailVerificationTtlHours * 60 * 60 * 1000);

  await pool.execute(
    'UPDATE email_verification_tokens SET used_at = COALESCE(used_at, NOW()) WHERE user_id = ? AND used_at IS NULL',
    [userId]
  );

  await pool.execute(
    'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, tokenHash, expiresAt]
  );

  const verifyLink = `${getAppBaseUrl(req)}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  await sendEmailVerificationEmail({
    to: email,
    name,
    verifyLink
  });
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
      longitude = null,
      is_donor = true
    } = req.body;

    const normalizedName = normalizeString(name);
    const normalizedEmail = normalizeString(email).toLowerCase();
    const normalizedPassword = typeof password === 'string' ? password : '';
    const normalizedBloodGroup = normalizeString(blood_group).toUpperCase();
    const normalizedPhone = normalizePhoneDigits(phone);
    const normalizedLocation = optionalStringOrNull(location);
    const normalizedCity = optionalStringOrNull(city);
    const normalizedState = optionalStringOrNull(state);
    const parsedLatitude = parseLatitude(latitude, false);
    const parsedLongitude = parseLongitude(longitude, false);
    const parsedIsDonor = normalizeBoolean(is_donor);
    const normalizedIsDonor = parsedIsDonor === undefined ? true : parsedIsDonor;

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

    if (isDisposableEmailDomain(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Disposable email addresses are not allowed. Please use a real email address.'
      });
    }

    if (!isValidPhone(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must be exactly 10 digits'
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

    if (is_donor !== undefined && parsedIsDonor === undefined) {
      return res.status(400).json({
        success: false,
        message: 'is_donor must be a boolean'
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
    const [useGeoColumns, useEmailVerifiedColumn] = await Promise.all([
      hasUserGeoColumns(),
      hasEmailVerifiedColumn()
    ]);

    const requiresEmailVerification = isMailConfigured() && useEmailVerifiedColumn;
    const insertColumns = ['name', 'email', 'password', 'phone', 'blood_group', 'location', 'city', 'state'];
    const insertValues = [
      normalizedName,
      normalizedEmail,
      hashedPassword,
      normalizedPhone,
      normalizedBloodGroup,
      normalizedLocation,
      normalizedCity,
      normalizedState
    ];

    if (useGeoColumns) {
      insertColumns.push('latitude', 'longitude');
      insertValues.push(parsedLatitude.value, parsedLongitude.value);
    }

    insertColumns.push('is_donor');
    insertValues.push(normalizedIsDonor);

    if (useEmailVerifiedColumn) {
      insertColumns.push('email_verified');
      insertValues.push(!requiresEmailVerification);
    }

    const placeholders = insertColumns.map(() => '?').join(', ');
    const [result] = await pool.execute(
      `INSERT INTO users (${insertColumns.join(', ')})
       VALUES (${placeholders})
       RETURNING id`,
      insertValues
    );

    if (requiresEmailVerification) {
      try {
        await createEmailVerificationToken({
          userId: result.insertId,
          email: normalizedEmail,
          name: normalizedName,
          req
        });
      } catch (verificationError) {
        await pool.execute('DELETE FROM email_verification_tokens WHERE user_id = ?', [result.insertId]);
        await pool.execute('DELETE FROM users WHERE id = ?', [result.insertId]);
        throw verificationError;
      }
    }

    return res.status(201).json({
      success: true,
      message: requiresEmailVerification
        ? 'User registered successfully. Please verify your email before login.'
        : 'User registered successfully',
      requires_verification: requiresEmailVerification,
      user: {
        id: result.insertId,
        name: normalizedName,
        email: normalizedEmail,
        blood_group: normalizedBloodGroup,
        location: normalizedLocation,
        is_donor: normalizedIsDonor,
        email_verified: !requiresEmailVerification,
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

    const [useGeoColumns, useEmailVerifiedColumn] = await Promise.all([
      hasUserGeoColumns(),
      hasEmailVerifiedColumn()
    ]);
    const [users] = await pool.execute(
      `SELECT id, name, email, password, phone, blood_group, location, city, state,
              ${useGeoColumns ? 'latitude, longitude' : 'NULL as latitude, NULL as longitude'},
              ${useEmailVerifiedColumn ? 'email_verified' : 'TRUE as email_verified'},
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

    if (useEmailVerifiedColumn && !user.email_verified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before login. Check your inbox for the verification link.',
        requires_verification: true
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

// Resend email verification
router.post('/resend-verification', authLimiter, async (req, res) => {
  try {
    const normalizedEmail = normalizeString(req.body.email).toLowerCase();
    if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    if (!isMailConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Email service is not configured. Please contact support.'
      });
    }

    const useEmailVerifiedColumn = await hasEmailVerifiedColumn();
    if (!useEmailVerifiedColumn) {
      return res.status(503).json({
        success: false,
        message: 'Email verification is not enabled yet. Run `npm run setup`.'
      });
    }

    const genericSuccessMessage = 'If an account exists for this email, a verification link has been sent.';
    const [users] = await pool.execute(
      'SELECT id, name, email, email_verified FROM users WHERE email = ?',
      [normalizedEmail]
    );

    if (users.length === 0) {
      return res.json({
        success: true,
        message: genericSuccessMessage
      });
    }

    const user = users[0];
    if (user.email_verified) {
      return res.json({
        success: true,
        message: 'Email is already verified. You can login.'
      });
    }

    await createEmailVerificationToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      req
    });

    return res.json({
      success: true,
      message: genericSuccessMessage
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to resend verification email'
    });
  }
});

// Verify email by token
router.get('/verify-email', async (req, res) => {
  let connection;
  try {
    const token = normalizeString(req.query.token).replace(/\s+/g, '');
    if (!token) {
      return res.redirect('/login?verified=failed');
    }

    const useEmailVerifiedColumn = await hasEmailVerifiedColumn();
    if (!useEmailVerifiedColumn) {
      return res.redirect('/login?verified=failed');
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [tokens] = await connection.execute(
      `SELECT id, user_id
       FROM email_verification_tokens
       WHERE token_hash = ?
         AND used_at IS NULL
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [tokenHash]
    );

    if (tokens.length === 0) {
      await connection.rollback();
      return res.redirect('/login?verified=failed');
    }

    const tokenRecord = tokens[0];
    await connection.execute(
      'UPDATE users SET email_verified = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [tokenRecord.user_id]
    );
    await connection.execute(
      'UPDATE email_verification_tokens SET used_at = NOW() WHERE id = ?',
      [tokenRecord.id]
    );
    await connection.execute(
      'UPDATE email_verification_tokens SET used_at = COALESCE(used_at, NOW()) WHERE user_id = ? AND id <> ?',
      [tokenRecord.user_id, tokenRecord.id]
    );

    await connection.commit();
    return res.redirect('/login?verified=1');
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Verify email error:', error);
    return res.redirect('/login?verified=failed');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Forgot Password
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const normalizedEmail = normalizeString(req.body.email).toLowerCase();
    if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    if (!isMailConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Password reset email service is not configured. Please contact support.'
      });
    }

    const genericSuccessMessage = 'If an account exists for this email, a password reset link has been sent.';

    const [users] = await pool.execute(
      'SELECT id, name, email FROM users WHERE email = ?',
      [normalizedEmail]
    );

    if (users.length === 0) {
      return res.json({
        success: true,
        message: genericSuccessMessage
      });
    }

    const user = users[0];
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + passwordResetTtlMinutes * 60 * 1000);

    await pool.execute(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [user.id, tokenHash, expiresAt]
    );

    const resetLink = `${getAppBaseUrl(req)}/reset-password?token=${encodeURIComponent(token)}`;
    await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      resetLink
    });

    return res.json({
      success: true,
      message: genericSuccessMessage
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process password reset request'
    });
  }
});

// Reset Password
router.post('/reset-password', authLimiter, async (req, res) => {
  let connection;
  try {
    const token = normalizeString(req.body.token).replace(/\s+/g, '');
    const newPassword = typeof req.body.new_password === 'string' ? req.body.new_password : '';

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const [tokens] = await pool.execute(
      `SELECT id, user_id
       FROM password_reset_tokens
       WHERE token_hash = ?
         AND used_at IS NULL
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [tokenHash]
    );

    if (tokens.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Reset token is invalid or expired'
      });
    }

    const tokenRecord = tokens[0];
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    await connection.execute(
      'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [hashedPassword, tokenRecord.user_id]
    );

    await connection.execute(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?',
      [tokenRecord.id]
    );

    await connection.execute(
      'UPDATE password_reset_tokens SET used_at = COALESCE(used_at, NOW()) WHERE user_id = ? AND id <> ?',
      [tokenRecord.user_id, tokenRecord.id]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: 'Password reset successful. Please login with your new password.'
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Reset password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reset password'
    });
  } finally {
    if (connection) {
      connection.release();
    }
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
      phone: normalizePhoneDigitsUpdate(phone),
      location: optionalUpdateString(location),
      city: optionalUpdateString(city),
      state: optionalUpdateString(state),
      latitude: parsedLatitude.value,
      longitude: parsedLongitude.value,
      is_donor: parsedIsDonor,
      is_recipient: parsedIsRecipient
    };

    if (normalizedUpdates.phone !== undefined && !isValidPhone(normalizedUpdates.phone)) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must be exactly 10 digits'
      });
    }

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
