const express = require('express');
const { pool } = require('../config/database');
const router = express.Router();

const BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const normalizeString = value => (typeof value === 'string' ? value.trim() : '');
const parsePositiveInt = value => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
const parseNonNegativeInt = value => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

// Get blood inventory
router.get('/all', async (req, res) => {
  try {
    const [inventory] = await pool.execute(
      'SELECT * FROM blood_inventory ORDER BY blood_group'
    );

    res.json({
      success: true,
      inventory
    });

  } catch (error) {
    console.error('Get blood inventory error:', error);
    res.status(500).json({
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

    const [inventory] = await pool.execute(
      'SELECT * FROM blood_inventory WHERE blood_group = ?',
      [bloodGroup]
    );

    if (inventory.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blood group not found in inventory'
      });
    }

    res.json({
      success: true,
      inventory: inventory[0]
    });

  } catch (error) {
    console.error('Get inventory by blood group error:', error);
    res.status(500).json({
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

    if (!bloodGroup || availableUnits === null || reservedUnits === null) {
      return res.status(400).json({
        success: false,
        message: 'Blood group, available_units, and reserved_units are required and must be non-negative integers'
      });
    }

    if (!BLOOD_GROUPS.has(bloodGroup)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blood group'
      });
    }

    const [result] = await pool.execute(
      'UPDATE blood_inventory SET available_units = ?, reserved_units = ?, last_updated = CURRENT_TIMESTAMP WHERE blood_group = ?',
      [availableUnits, reservedUnits, bloodGroup]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blood group not found in inventory'
      });
    }

    res.json({
      success: true,
      message: 'Blood inventory updated successfully'
    });

  } catch (error) {
    console.error('Update blood inventory error:', error);
    res.status(500).json({
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

    const [result] = await pool.execute(
      'UPDATE blood_inventory SET available_units = available_units + ?, last_updated = CURRENT_TIMESTAMP WHERE blood_group = ?',
      [units, bloodGroup]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blood group not found in inventory'
      });
    }

    res.json({
      success: true,
      message: `${units} units of ${bloodGroup} blood added to inventory`
    });

  } catch (error) {
    console.error('Add blood units error:', error);
    res.status(500).json({
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

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Check if enough units are available
    const [inventory] = await connection.execute(
      'SELECT available_units FROM blood_inventory WHERE blood_group = ? FOR UPDATE',
      [bloodGroup]
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

    // Reserve the units
    await connection.execute(
      `UPDATE blood_inventory 
       SET available_units = available_units - ?, 
           reserved_units = reserved_units + ?, 
           last_updated = CURRENT_TIMESTAMP 
       WHERE blood_group = ?`,
      [units, units, bloodGroup]
    );

    await connection.commit();

    res.json({
      success: true,
      message: `${units} units of ${bloodGroup} blood reserved successfully`
    });

  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Reserve blood units error:', error);
    res.status(500).json({
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

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Check if enough units are reserved
    const [inventory] = await connection.execute(
      'SELECT reserved_units FROM blood_inventory WHERE blood_group = ? FOR UPDATE',
      [bloodGroup]
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

    // Release the units
    await connection.execute(
      `UPDATE blood_inventory 
       SET available_units = available_units + ?, 
           reserved_units = reserved_units - ?, 
           last_updated = CURRENT_TIMESTAMP 
       WHERE blood_group = ?`,
      [units, units, bloodGroup]
    );

    await connection.commit();

    res.json({
      success: true,
      message: `${units} units of ${bloodGroup} blood released successfully`
    });

  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Release blood units error:', error);
    res.status(500).json({
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

    const [lowStock] = await pool.execute(
      'SELECT * FROM blood_inventory WHERE available_units <= ? ORDER BY available_units ASC',
      [threshold]
    );

    res.json({
      success: true,
      lowStock,
      threshold
    });

  } catch (error) {
    console.error('Get low stock alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get inventory statistics
router.get('/statistics', async (req, res) => {
  try {
    // Total available units
    const [totalAvailable] = await pool.execute(
      'SELECT SUM(available_units) as total FROM blood_inventory'
    );

    // Total reserved units
    const [totalReserved] = await pool.execute(
      'SELECT SUM(reserved_units) as total FROM blood_inventory'
    );

    // Blood group with highest availability
    const [highestAvailable] = await pool.execute(
      'SELECT blood_group, available_units FROM blood_inventory ORDER BY available_units DESC LIMIT 1'
    );

    // Blood group with lowest availability
    const [lowestAvailable] = await pool.execute(
      'SELECT blood_group, available_units FROM blood_inventory ORDER BY available_units ASC LIMIT 1'
    );

    // Critical stock (less than 5 units)
    const [criticalStock] = await pool.execute(
      'SELECT COUNT(*) as count FROM blood_inventory WHERE available_units < 5'
    );

    res.json({
      success: true,
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
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Initialize inventory for a blood group
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

    // Check if blood group already exists
    const [existing] = await pool.execute(
      'SELECT id FROM blood_inventory WHERE blood_group = ?',
      [bloodGroup]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Blood group already exists in inventory'
      });
    }

    // Insert new blood group
    await pool.execute(
      'INSERT INTO blood_inventory (blood_group, available_units, reserved_units) VALUES (?, ?, ?)',
      [bloodGroup, availableUnits, reservedUnits]
    );

    res.status(201).json({
      success: true,
      message: `Blood group ${bloodGroup} initialized in inventory`
    });

  } catch (error) {
    console.error('Initialize inventory error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
