const { pool } = require('../config/database');

const ROLES = Object.freeze({
  USER: 'user',
  HOSPITAL: 'hospital',
  BLOOD_BANK: 'blood_bank',
  DOCTOR: 'doctor',
  ADMIN: 'admin'
});

const ROLE_VALUES = new Set(Object.values(ROLES));
const AUTHORITY_ROLES = new Set([ROLES.HOSPITAL, ROLES.BLOOD_BANK, ROLES.DOCTOR, ROLES.ADMIN]);

const normalizeRole = value => {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase()
    : '';

  return ROLE_VALUES.has(normalized) ? normalized : ROLES.USER;
};

const parsePositiveInt = value => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const getActorUserIdFromRequest = req => {
  const candidates = [
    req.headers['x-actor-user-id'],
    req.headers['x-user-id'],
    req.body && req.body.actor_user_id,
    req.query && req.query.actor_user_id
  ];

  for (const candidate of candidates) {
    const parsed = parsePositiveInt(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const getUserById = async userId => {
  const parsedUserId = parsePositiveInt(userId);
  if (!parsedUserId) {
    return null;
  }

  let users;
  try {
    [users] = await pool.execute(
      `SELECT id, name, email, role, is_verified, is_active, facility_id, city, state, latitude, longitude, blood_group
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [parsedUserId]
    );
  } catch (error) {
    if (error && error.code === '42703') {
      [users] = await pool.execute(
        `SELECT id, name, email, city, state, latitude, longitude, blood_group
         FROM users
         WHERE id = ?
         LIMIT 1`,
        [parsedUserId]
      );

      users = users.map(user => ({
        ...user,
        role: ROLES.USER,
        is_verified: true,
        is_active: true,
        facility_id: null
      }));
    } else {
      throw error;
    }
  }

  if (users.length === 0) {
    return null;
  }

  const user = users[0];
  user.id = parsePositiveInt(user.id) || user.id;
  user.facility_id = user.facility_id === null || user.facility_id === undefined
    ? null
    : (parsePositiveInt(user.facility_id) || user.facility_id);
  user.role = normalizeRole(user.role);
  user.is_verified = Boolean(user.is_verified);
  user.is_active = user.is_active !== false;

  return user;
};

const resolveActorUser = async (req, { required = false } = {}) => {
  const actorUserId = getActorUserIdFromRequest(req);

  if (!actorUserId) {
    if (required) {
      return {
        user: null,
        status: 400,
        message: 'actor_user_id is required for this operation'
      };
    }

    return {
      user: null,
      status: null,
      message: null
    };
  }

  const user = await getUserById(actorUserId);
  if (!user) {
    return {
      user: null,
      status: 404,
      message: 'Acting user not found'
    };
  }

  if (!user.is_active) {
    return {
      user: null,
      status: 403,
      message: 'Acting user account is inactive'
    };
  }

  return {
    user,
    status: null,
    message: null
  };
};

const isVerifiedAuthority = user => (
  Boolean(user) &&
  AUTHORITY_ROLES.has(normalizeRole(user.role)) &&
  (normalizeRole(user.role) === ROLES.ADMIN || Boolean(user.is_verified)) &&
  user.is_active !== false
);

module.exports = {
  ROLES,
  ROLE_VALUES,
  AUTHORITY_ROLES,
  normalizeRole,
  parsePositiveInt,
  getActorUserIdFromRequest,
  getUserById,
  resolveActorUser,
  isVerifiedAuthority
};
