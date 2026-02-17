const express = require('express');
const { pool } = require('../config/database');
const {
  ROLES,
  parsePositiveInt,
  resolveActorUser,
  isVerifiedAuthority,
  normalizeRole
} = require('../services/accessControl');

const router = express.Router();

const BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);

const normalizeString = value => (typeof value === 'string' ? value.trim() : '');

const parseNonNegativeInt = value => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const scopeClause = hospitalId => (
  hospitalId === null
    ? { sql: 'hospital_id IS NULL', params: [] }
    : { sql: 'hospital_id = ?', params: [hospitalId] }
);

const getHospitalScopeFromRequest = req => {
  const input = req.body.hospital_id ?? req.query.hospital_id;
  if (input === undefined || input === null || input === '') {
    return { hospitalId: null, error: null };
  }

  const parsed = parsePositiveInt(input);
  if (!parsed) {
    return { hospitalId: null, error: 'hospital_id must be a positive integer' };
  }

  return { hospitalId: parsed, error: null };
};

const assertAuthorityForScopedWrite = async (req, hospitalId) => {
  const actor = await resolveActorUser(req, { required: true });
  if (actor.message) {
    return actor;
  }

  if (!isVerifiedAuthority(actor.user)) {
    return {
      user: null,
      status: 403,
      message: 'Only verified hospital, blood bank, doctor, or admin accounts can modify inventory'
    };
  }

  const actorRole = normalizeRole(actor.user.role);
  if (hospitalId === null) {
    return actor;
  }

  if (actorRole === ROLES.ADMIN) {
    return actor;
  }

  if ((actorRole === ROLES.HOSPITAL || actorRole === ROLES.BLOOD_BANK) && actor.user.id === hospitalId) {
    return actor;
  }

  if (actorRole === ROLES.DOCTOR && actor.user.facility_id === hospitalId) {
    return actor;
  }

  return {
    user: null,
    status: 403,
    message: 'You do not have permission to manage this hospital inventory'
  };
};

const createPassiveStockAlerts = async ({
  hospitalId,
  bloodGroup,
  availableUnits,
  threshold
}) => {
  if (!hospitalId || availableUnits > threshold) {
    return 0;
  }

  const [facilities] = await pool.execute(
    `SELECT id, name, city, state
     FROM users
     WHERE id = ?
       AND role IN ('hospital', 'blood_bank')
       AND is_active = TRUE
     LIMIT 1`,
    [hospitalId]
  );

  if (facilities.length === 0) {
    return 0;
  }

  const facility = facilities[0];
  const donorParams = [bloodGroup];
  let donorFilter = `
    WHERE is_donor = TRUE
      AND is_active = TRUE
      AND blood_group = ?
      AND (alert_snooze_until IS NULL OR alert_snooze_until <= NOW())
      AND role = 'user'
  `;

  if (facility.city) {
    donorFilter += ' AND city ILIKE ?';
    donorParams.push(facility.city);
  } else if (facility.state) {
    donorFilter += ' AND state ILIKE ?';
    donorParams.push(facility.state);
  }

  donorParams.push(200);

  const [donors] = await pool.execute(
    `SELECT id
     FROM users
     ${donorFilter}
     ORDER BY updated_at DESC, created_at DESC
     LIMIT ?`,
    donorParams
  );

  if (donors.length === 0) {
    return 0;
  }

  const title = `${facility.name} needs ${bloodGroup}`;
  const message = `${facility.name} inventory for ${bloodGroup} is low (${availableUnits} units). Please donate this week if you are available.`;
  const metadata = JSON.stringify({
    hospital_id: facility.id,
    blood_group: bloodGroup,
    available_units: availableUnits
  });

  for (const donor of donors) {
    await pool.execute(
      `INSERT INTO user_notifications (user_id, title, message, type, metadata)
       VALUES (?, ?, ?, 'warning', ?::jsonb)`,
      [donor.id, title, message, metadata]
    );
  }

  return donors.length;
};

// Get blood inventory
router.get('/all', async (req, res) => {
  try {
    const scope = getHospitalScopeFromRequest(req);
    if (scope.error) {
      return res.status(400).json({
        success: false,
        message: scope.error
      });
    }

    const scoped = scopeClause(scope.hospitalId);
    const [inventory] = await pool.execute(
      `SELECT id, hospital_id, blood_group, available_units, reserved_units, last_updated
       FROM blood_inventory
       WHERE ${scoped.sql}
       ORDER BY blood_group`,
      scoped.params
    );

    return res.json({
      success: true,
      hospital_id: scope.hospitalId,
      inventory
    });
  } catch (error) {
    console.error('Get blood inventory error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get inventory by blood group
router.get('/blood-group/:bloodGroup', async (req, res) => {
  try {
    const bloodGroup = normalizeString(req.params.bloodGroup).toUpperCase();
    if (!BLOOD_GROUPS.has(bloodGroup)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blood group'
      });
    }

    const scope = getHospitalScopeFromRequest(req);
    if (scope.error) {
      return res.status(400).json({
        success: false,
        message: scope.error
      });
    }

    const scoped = scopeClause(scope.hospitalId);
    const [inventory] = await pool.execute(
      `SELECT id, hospital_id, blood_group, available_units, reserved_units, last_updated
       FROM blood_inventory
       WHERE blood_group = ? AND ${scoped.sql}
       LIMIT 1`,
      [bloodGroup, ...scoped.params]
    );

    if (inventory.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blood group not found in inventory'
      });
    }

    return res.json({
      success: true,
      inventory: inventory[0]
    });
  } catch (error) {
    console.error('Get inventory by blood group error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update blood inventory
router.put('/update', async (req, res) => {
  try {
    const bloodGroup = normalizeString(req.body.blood_group).toUpperCase();
    const availableUnits = parseNonNegativeInt(req.body.available_units);
    const reservedUnits = parseNonNegativeInt(req.body.reserved_units);
    const lowStockThreshold = req.body.low_stock_threshold === undefined
      ? 10
      : parseNonNegativeInt(req.body.low_stock_threshold);

    if (!bloodGroup || availableUnits === null || reservedUnits === null) {
      return res.status(400).json({
        success: false,
        message: 'blood_group, available_units, and reserved_units are required and must be non-negative integers'
      });
    }

    if (lowStockThreshold === null) {
      return res.status(400).json({
        success: false,
        message: 'low_stock_threshold must be a non-negative integer'
      });
    }

    if (!BLOOD_GROUPS.has(bloodGroup)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blood group'
      });
    }

    const scope = getHospitalScopeFromRequest(req);
    if (scope.error) {
      return res.status(400).json({
        success: false,
        message: scope.error
      });
    }

    const authority = await assertAuthorityForScopedWrite(req, scope.hospitalId);
    if (authority.message) {
      return res.status(authority.status).json({
        success: false,
        message: authority.message
      });
    }

    const scoped = scopeClause(scope.hospitalId);
    const [updateResult] = await pool.execute(
      `UPDATE blood_inventory
       SET available_units = ?, reserved_units = ?, last_updated = CURRENT_TIMESTAMP
       WHERE blood_group = ? AND ${scoped.sql}`,
      [availableUnits, reservedUnits, bloodGroup, ...scoped.params]
    );

    if (updateResult.affectedRows === 0) {
      await pool.execute(
        `INSERT INTO blood_inventory (hospital_id, blood_group, available_units, reserved_units)
         VALUES (?, ?, ?, ?)`,
        [scope.hospitalId, bloodGroup, availableUnits, reservedUnits]
      );
    }

    const passiveAlertsSent = await createPassiveStockAlerts({
      hospitalId: scope.hospitalId,
      bloodGroup,
      availableUnits,
      threshold: lowStockThreshold
    });

    return res.json({
      success: true,
      message: 'Blood inventory updated successfully',
      hospital_id: scope.hospitalId,
      passive_alerts_sent: passiveAlertsSent
    });
  } catch (error) {
    console.error('Update blood inventory error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Add blood units to inventory
router.post('/add', async (req, res) => {
  try {
    const bloodGroup = normalizeString(req.body.blood_group).toUpperCase();
    const units = parsePositiveInt(req.body.units);

    if (!bloodGroup || !units) {
      return res.status(400).json({
        success: false,
        message: 'Blood group and units are required. units must be a positive integer'
      });
    }

    if (!BLOOD_GROUPS.has(bloodGroup)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blood group'
      });
    }

    const scope = getHospitalScopeFromRequest(req);
    if (scope.error) {
      return res.status(400).json({
        success: false,
        message: scope.error
      });
    }

    const authority = await assertAuthorityForScopedWrite(req, scope.hospitalId);
    if (authority.message) {
      return res.status(authority.status).json({
        success: false,
        message: authority.message
      });
    }

    const scoped = scopeClause(scope.hospitalId);
    const [result] = await pool.execute(
      `UPDATE blood_inventory
       SET available_units = available_units + ?, last_updated = CURRENT_TIMESTAMP
       WHERE blood_group = ? AND ${scoped.sql}`,
      [units, bloodGroup, ...scoped.params]
    );

    if (result.affectedRows === 0) {
      await pool.execute(
        `INSERT INTO blood_inventory (hospital_id, blood_group, available_units, reserved_units)
         VALUES (?, ?, ?, 0)`,
        [scope.hospitalId, bloodGroup, units]
      );
    }

    return res.json({
      success: true,
      message: `${units} units of ${bloodGroup} blood added to inventory`,
      hospital_id: scope.hospitalId
    });
  } catch (error) {
    console.error('Add blood units error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Reserve blood units
router.post('/reserve', async (req, res) => {
  let connection;
  try {
    const bloodGroup = normalizeString(req.body.blood_group).toUpperCase();
    const units = parsePositiveInt(req.body.units);

    if (!bloodGroup || !units) {
      return res.status(400).json({
        success: false,
        message: 'Blood group and units are required. units must be a positive integer'
      });
    }

    if (!BLOOD_GROUPS.has(bloodGroup)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blood group'
      });
    }

    const scope = getHospitalScopeFromRequest(req);
    if (scope.error) {
      return res.status(400).json({
        success: false,
        message: scope.error
      });
    }

    const authority = await assertAuthorityForScopedWrite(req, scope.hospitalId);
    if (authority.message) {
      return res.status(authority.status).json({
        success: false,
        message: authority.message
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const scoped = scopeClause(scope.hospitalId);
    const [inventory] = await connection.execute(
      `SELECT available_units
       FROM blood_inventory
       WHERE blood_group = ? AND ${scoped.sql}
       FOR UPDATE`,
      [bloodGroup, ...scoped.params]
    );

    if (inventory.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Blood group not found in inventory'
      });
    }

    if (inventory[0].available_units < units) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient ${bloodGroup} blood units. Available: ${inventory[0].available_units}`
      });
    }

    await connection.execute(
      `UPDATE blood_inventory
       SET available_units = available_units - ?,
           reserved_units = reserved_units + ?,
           last_updated = CURRENT_TIMESTAMP
       WHERE blood_group = ? AND ${scoped.sql}`,
      [units, units, bloodGroup, ...scoped.params]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: `${units} units of ${bloodGroup} blood reserved successfully`,
      hospital_id: scope.hospitalId
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Reserve blood units error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Release reserved blood units
router.post('/release', async (req, res) => {
  let connection;
  try {
    const bloodGroup = normalizeString(req.body.blood_group).toUpperCase();
    const units = parsePositiveInt(req.body.units);

    if (!bloodGroup || !units) {
      return res.status(400).json({
        success: false,
        message: 'Blood group and units are required. units must be a positive integer'
      });
    }

    if (!BLOOD_GROUPS.has(bloodGroup)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blood group'
      });
    }

    const scope = getHospitalScopeFromRequest(req);
    if (scope.error) {
      return res.status(400).json({
        success: false,
        message: scope.error
      });
    }

    const authority = await assertAuthorityForScopedWrite(req, scope.hospitalId);
    if (authority.message) {
      return res.status(authority.status).json({
        success: false,
        message: authority.message
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const scoped = scopeClause(scope.hospitalId);
    const [inventory] = await connection.execute(
      `SELECT reserved_units
       FROM blood_inventory
       WHERE blood_group = ? AND ${scoped.sql}
       FOR UPDATE`,
      [bloodGroup, ...scoped.params]
    );

    if (inventory.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Blood group not found in inventory'
      });
    }

    if (inventory[0].reserved_units < units) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: `Insufficient reserved ${bloodGroup} blood units. Reserved: ${inventory[0].reserved_units}`
      });
    }

    await connection.execute(
      `UPDATE blood_inventory
       SET available_units = available_units + ?,
           reserved_units = reserved_units - ?,
           last_updated = CURRENT_TIMESTAMP
       WHERE blood_group = ? AND ${scoped.sql}`,
      [units, units, bloodGroup, ...scoped.params]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: `${units} units of ${bloodGroup} blood released successfully`,
      hospital_id: scope.hospitalId
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Release blood units error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Get low stock alerts
router.get('/low-stock', async (req, res) => {
  try {
    const threshold = req.query.threshold === undefined
      ? 10
      : parseNonNegativeInt(req.query.threshold);
    if (threshold === null) {
      return res.status(400).json({
        success: false,
        message: 'threshold must be a non-negative integer'
      });
    }

    const scope = getHospitalScopeFromRequest(req);
    if (scope.error) {
      return res.status(400).json({
        success: false,
        message: scope.error
      });
    }

    const scoped = scopeClause(scope.hospitalId);
    const [lowStock] = await pool.execute(
      `SELECT id, hospital_id, blood_group, available_units, reserved_units, last_updated
       FROM blood_inventory
       WHERE available_units <= ? AND ${scoped.sql}
       ORDER BY available_units ASC`,
      [threshold, ...scoped.params]
    );

    return res.json({
      success: true,
      hospital_id: scope.hospitalId,
      lowStock,
      threshold
    });
  } catch (error) {
    console.error('Get low stock alerts error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get inventory statistics
router.get('/statistics', async (req, res) => {
  try {
    const scope = getHospitalScopeFromRequest(req);
    if (scope.error) {
      return res.status(400).json({
        success: false,
        message: scope.error
      });
    }

    const scoped = scopeClause(scope.hospitalId);
    const [totalAvailable] = await pool.execute(
      `SELECT COALESCE(SUM(available_units), 0) as total
       FROM blood_inventory
       WHERE ${scoped.sql}`,
      scoped.params
    );
    const [totalReserved] = await pool.execute(
      `SELECT COALESCE(SUM(reserved_units), 0) as total
       FROM blood_inventory
       WHERE ${scoped.sql}`,
      scoped.params
    );
    const [highestAvailable] = await pool.execute(
      `SELECT blood_group, available_units
       FROM blood_inventory
       WHERE ${scoped.sql}
       ORDER BY available_units DESC
       LIMIT 1`,
      scoped.params
    );
    const [lowestAvailable] = await pool.execute(
      `SELECT blood_group, available_units
       FROM blood_inventory
       WHERE ${scoped.sql}
       ORDER BY available_units ASC
       LIMIT 1`,
      scoped.params
    );
    const [criticalStock] = await pool.execute(
      `SELECT COUNT(*) as count
       FROM blood_inventory
       WHERE available_units < 5 AND ${scoped.sql}`,
      scoped.params
    );

    return res.json({
      success: true,
      hospital_id: scope.hospitalId,
      statistics: {
        totalAvailable: totalAvailable[0].total || 0,
        totalReserved: totalReserved[0].total || 0,
        highestAvailable: highestAvailable[0] || null,
        lowestAvailable: lowestAvailable[0] || null,
        criticalStockCount: criticalStock[0].count
      }
    });
  } catch (error) {
    console.error('Get inventory statistics error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Initialize inventory row for a blood group
router.post('/initialize', async (req, res) => {
  try {
    const bloodGroup = normalizeString(req.body.blood_group).toUpperCase();
    const availableUnits = req.body.available_units === undefined
      ? 0
      : parseNonNegativeInt(req.body.available_units);
    const reservedUnits = req.body.reserved_units === undefined
      ? 0
      : parseNonNegativeInt(req.body.reserved_units);

    if (!bloodGroup) {
      return res.status(400).json({
        success: false,
        message: 'Blood group is required'
      });
    }

    if (!BLOOD_GROUPS.has(bloodGroup)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blood group'
      });
    }

    if (availableUnits === null || reservedUnits === null) {
      return res.status(400).json({
        success: false,
        message: 'available_units and reserved_units must be non-negative integers'
      });
    }

    const scope = getHospitalScopeFromRequest(req);
    if (scope.error) {
      return res.status(400).json({
        success: false,
        message: scope.error
      });
    }

    const authority = await assertAuthorityForScopedWrite(req, scope.hospitalId);
    if (authority.message) {
      return res.status(authority.status).json({
        success: false,
        message: authority.message
      });
    }

    const scoped = scopeClause(scope.hospitalId);
    const [existing] = await pool.execute(
      `SELECT id
       FROM blood_inventory
       WHERE blood_group = ? AND ${scoped.sql}
       LIMIT 1`,
      [bloodGroup, ...scoped.params]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Blood group already exists in inventory'
      });
    }

    await pool.execute(
      `INSERT INTO blood_inventory (hospital_id, blood_group, available_units, reserved_units)
       VALUES (?, ?, ?, ?)`,
      [scope.hospitalId, bloodGroup, availableUnits, reservedUnits]
    );

    return res.status(201).json({
      success: true,
      message: `Blood group ${bloodGroup} initialized in inventory`,
      hospital_id: scope.hospitalId
    });
  } catch (error) {
    console.error('Initialize inventory error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
