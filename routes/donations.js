const express = require('express');
const crypto = require('crypto');
const { pool } = require('../config/database');
const cacheService = require('../services/cache');
const {
  ROLES,
  resolveActorUser,
  isVerifiedAuthority,
  normalizeRole
} = require('../services/accessControl');
const router = express.Router();

const BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const normalizeString = value => (typeof value === 'string' ? value.trim() : '');
const optionalStringOrNull = value => {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = normalizeString(value);
  return normalized || null;
};
const parsePositiveInt = value => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
const isIsoDate = value => (
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
);
const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const parseBooleanEnv = value => {
  if (value === undefined || value === null) {
    return false;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const requireAuthorityForCompletion = parseBooleanEnv(process.env.REQUIRE_AUTHORITY_FOR_DONATION_COMPLETION);

const donationVerificationColumnsState = {
  checked: false,
  available: false
};

const inventoryHospitalColumnState = {
  checked: false,
  available: false
};

const hasDonationVerificationColumns = async () => {
  if (donationVerificationColumnsState.checked) {
    return donationVerificationColumnsState.available;
  }

  try {
    const [columns] = await pool.execute(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'blood_donations'
         AND column_name IN (
           'completion_verified',
           'completed_by',
           'completion_verified_at',
           'completion_method',
           'verification_qr_token',
           'verification_qr_expires_at'
         )`
    );

    const foundColumns = new Set(columns.map(column => column.column_name));
    const requiredColumns = [
      'completion_verified',
      'completed_by',
      'completion_verified_at',
      'completion_method',
      'verification_qr_token',
      'verification_qr_expires_at'
    ];

    donationVerificationColumnsState.available = requiredColumns.every(column => foundColumns.has(column));
  } catch (error) {
    donationVerificationColumnsState.available = false;
  } finally {
    donationVerificationColumnsState.checked = true;
  }

  return donationVerificationColumnsState.available;
};

const hasInventoryHospitalColumn = async () => {
  if (inventoryHospitalColumnState.checked) {
    return inventoryHospitalColumnState.available;
  }

  try {
    const [columns] = await pool.execute(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'blood_inventory'
         AND column_name = 'hospital_id'`
    );
    inventoryHospitalColumnState.available = columns.length > 0;
  } catch (error) {
    inventoryHospitalColumnState.available = false;
  } finally {
    inventoryHospitalColumnState.checked = true;
  }

  return inventoryHospitalColumnState.available;
};

const resolveCompletionScopeHospitalId = verifierUser => {
  if (!verifierUser || !isVerifiedAuthority(verifierUser)) {
    return null;
  }

  const role = normalizeRole(verifierUser.role);
  if (role === ROLES.HOSPITAL || role === ROLES.BLOOD_BANK) {
    return verifierUser.id;
  }

  if (role === ROLES.DOCTOR) {
    return verifierUser.facility_id || null;
  }

  return null;
};

const resolveCompletionMethod = verifierUser => {
  if (!verifierUser || !isVerifiedAuthority(verifierUser)) {
    return 'self';
  }

  const role = normalizeRole(verifierUser.role);
  if (role === ROLES.HOSPITAL) {
    return 'hospital_scan';
  }
  if (role === ROLES.BLOOD_BANK) {
    return 'blood_bank_scan';
  }
  if (role === ROLES.DOCTOR) {
    return 'doctor_verify';
  }
  return 'admin_verify';
};

// Schedule a blood donation
router.post('/schedule', async (req, res) => {
  let connection;
  try {
    const {
      donor_id,
      request_id = null,
      donation_date,
      blood_group,
      units_donated = 1,
      donation_center = null,
      notes = null
    } = req.body;

    const normalizedDonorId = parsePositiveInt(donor_id);
    const normalizedRequestId = request_id === undefined || request_id === null || request_id === ''
      ? null
      : parsePositiveInt(request_id);
    const normalizedDonationDate = normalizeString(donation_date);
    const normalizedBloodGroup = normalizeString(blood_group).toUpperCase();
    const normalizedUnitsDonated = parsePositiveInt(units_donated || 1);
    const normalizedDonationCenter = optionalStringOrNull(donation_center);
    const normalizedNotes = optionalStringOrNull(notes);

    // Validate required fields
    if (!normalizedDonorId || !normalizedDonationDate || !normalizedBloodGroup) {
      return res.status(400).json({
        success: false,
        message: 'Donor ID, donation date, and blood group are required'
      });
    }

    if (!BLOOD_GROUPS.has(normalizedBloodGroup)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blood group'
      });
    }

    if (!normalizedUnitsDonated) {
      return res.status(400).json({
        success: false,
        message: 'units_donated must be a positive integer'
      });
    }

    if (request_id !== null && request_id !== '' && !normalizedRequestId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request ID'
      });
    }

    if (!isIsoDate(normalizedDonationDate)) {
      return res.status(400).json({
        success: false,
        message: 'donation_date must be in YYYY-MM-DD format'
      });
    }

    const useDonationVerificationColumns = await hasDonationVerificationColumns();
    const verificationQrToken = useDonationVerificationColumns
      ? crypto.randomBytes(24).toString('hex')
      : null;
    const verificationQrExpiresAt = useDonationVerificationColumns
      ? addDays(new Date(normalizedDonationDate), 30).toISOString()
      : null;

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Check if donor exists and get their blood group
    const [donors] = await connection.execute(
      'SELECT blood_group, last_donation_date FROM users WHERE id = ?',
      [normalizedDonorId]
    );

    if (donors.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Donor not found'
      });
    }

    // Verify blood group matches
    if (donors[0].blood_group !== normalizedBloodGroup) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Blood group does not match donor record'
      });
    }

    if (donors[0].last_donation_date) {
      const lastDonationDate = new Date(donors[0].last_donation_date);
      const nextEligibleDate = addDays(lastDonationDate, 90);
      const requestedDate = new Date(normalizedDonationDate);

      if (requestedDate < nextEligibleDate) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Donor is eligible again on ${nextEligibleDate.toISOString().slice(0, 10)}`
        });
      }
    }

    // Insert donation record
    let result;
    if (useDonationVerificationColumns) {
      [result] = await connection.execute(
        `INSERT INTO blood_donations 
         (donor_id, request_id, donation_date, blood_group, units_donated, donation_center, notes,
          verification_qr_token, verification_qr_expires_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
        [
          normalizedDonorId,
          normalizedRequestId,
          normalizedDonationDate,
          normalizedBloodGroup,
          normalizedUnitsDonated,
          normalizedDonationCenter,
          normalizedNotes,
          verificationQrToken,
          verificationQrExpiresAt
        ]
      );
    } else {
      [result] = await connection.execute(
        `INSERT INTO blood_donations 
         (donor_id, request_id, donation_date, blood_group, units_donated, donation_center, notes) 
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
        [
          normalizedDonorId,
          normalizedRequestId,
          normalizedDonationDate,
          normalizedBloodGroup,
          normalizedUnitsDonated,
          normalizedDonationCenter,
          normalizedNotes
        ]
      );
    }

    await connection.commit();
    await cacheService.invalidatePrefix('matching:nearby:');

    res.status(201).json({
      success: true,
      message: 'Blood donation scheduled successfully',
      donation_id: result.insertId,
      donation_pass: verificationQrToken
        ? {
          verification_qr_token: verificationQrToken,
          expires_at: verificationQrExpiresAt
        }
        : null
    });

  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Schedule donation error:', error);
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

// Complete a blood donation
router.put('/:id/complete', async (req, res) => {
  let connection;
  try {
    const donationId = parsePositiveInt(req.params.id);
    if (!donationId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid donation ID'
      });
    }
    const notes = optionalStringOrNull(req.body.notes);
    const useDonationVerificationColumns = await hasDonationVerificationColumns();
    const useInventoryHospitalColumn = await hasInventoryHospitalColumn();
    const actor = await resolveActorUser(req, { required: false });
    if (actor.message) {
      return res.status(actor.status).json({
        success: false,
        message: actor.message
      });
    }

    const verifierUser = actor.user && isVerifiedAuthority(actor.user) ? actor.user : null;
    if (requireAuthorityForCompletion && !verifierUser) {
      return res.status(403).json({
        success: false,
        message: 'A verified hospital, blood bank, doctor, or admin account must complete donations.'
      });
    }
    const completionVerified = Boolean(verifierUser);
    const completionMethod = resolveCompletionMethod(verifierUser);
    const completionScopeHospitalId = resolveCompletionScopeHospitalId(verifierUser);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Update donation status to completed only once
    let result;
    if (useDonationVerificationColumns) {
      [result] = await connection.execute(
        `UPDATE blood_donations 
         SET status = 'Completed',
             notes = COALESCE(?, notes),
             completion_verified = ?,
             completed_by = ?,
             completion_verified_at = CASE WHEN ? THEN NOW() ELSE NULL END,
             completion_method = ?,
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = ? AND status <> 'Completed'`,
        [notes, completionVerified, verifierUser ? verifierUser.id : null, completionVerified, completionMethod, donationId]
      );
    } else {
      [result] = await connection.execute(
        `UPDATE blood_donations 
         SET status = 'Completed', notes = COALESCE(?, notes), updated_at = CURRENT_TIMESTAMP 
         WHERE id = ? AND status <> 'Completed'`,
        [notes, donationId]
      );
    }

    if (result.affectedRows === 0) {
      const [existing] = await connection.execute(
        'SELECT status FROM blood_donations WHERE id = ?',
        [donationId]
      );

      await connection.rollback();

      if (existing.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Donation record not found'
        });
      }

      return res.status(400).json({
        success: false,
        message: `Donation is already ${existing[0].status}`
      });
    }

    // Get donation details to update inventory
    const [donations] = await connection.execute(
      'SELECT donor_id, donation_date, blood_group, units_donated FROM blood_donations WHERE id = ?',
      [donationId]
    );

    if (donations.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Donation record not found'
      });
    }

    const donation = donations[0];

    // Update blood inventory
    if (useInventoryHospitalColumn && completionScopeHospitalId !== null) {
      const [inventoryUpdate] = await connection.execute(
        `UPDATE blood_inventory
         SET available_units = available_units + ?
         WHERE blood_group = ? AND hospital_id = ?`,
        [donation.units_donated, donation.blood_group, completionScopeHospitalId]
      );

      if (inventoryUpdate.affectedRows === 0) {
        await connection.execute(
          `INSERT INTO blood_inventory (hospital_id, blood_group, available_units, reserved_units)
           VALUES (?, ?, ?, 0)`,
          [completionScopeHospitalId, donation.blood_group, donation.units_donated]
        );
      }
    } else {
      const [inventoryUpdate] = await connection.execute(
        `UPDATE blood_inventory
         SET available_units = available_units + ?
         WHERE blood_group = ? AND ${useInventoryHospitalColumn ? 'hospital_id IS NULL' : 'TRUE'}`,
        [donation.units_donated, donation.blood_group]
      );

      if (inventoryUpdate.affectedRows === 0) {
        if (useInventoryHospitalColumn) {
          await connection.execute(
            'INSERT INTO blood_inventory (hospital_id, blood_group, available_units, reserved_units) VALUES (NULL, ?, ?, 0)',
            [donation.blood_group, donation.units_donated]
          );
        } else {
          await connection.execute(
            'INSERT INTO blood_inventory (blood_group, available_units, reserved_units) VALUES (?, ?, 0)',
            [donation.blood_group, donation.units_donated]
          );
        }
      }
    }

    await connection.execute(
      'UPDATE users SET last_donation_date = ?, is_donor = TRUE WHERE id = ?',
      [donation.donation_date, donation.donor_id]
    );

    await connection.commit();
    await cacheService.invalidatePrefix('matching:nearby:');

    res.json({
      success: true,
      message: completionVerified
        ? 'Blood donation completed and medically verified successfully'
        : 'Blood donation completed successfully',
      completion_verified: completionVerified,
      completion_method: completionMethod
    });

  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Complete donation error:', error);
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

// Complete a donation using verification QR token (hospital/doctor scan flow)
router.post('/complete-by-token', async (req, res) => {
  let connection;
  try {
    const verificationQrToken = normalizeString(req.body.verification_qr_token);
    const notes = optionalStringOrNull(req.body.notes);

    if (!verificationQrToken) {
      return res.status(400).json({
        success: false,
        message: 'verification_qr_token is required'
      });
    }

    const useDonationVerificationColumns = await hasDonationVerificationColumns();
    if (!useDonationVerificationColumns) {
      return res.status(503).json({
        success: false,
        message: 'QR verification workflow is not enabled yet. Run `npm run setup`.'
      });
    }

    const useInventoryHospitalColumn = await hasInventoryHospitalColumn();
    const actor = await resolveActorUser(req, { required: true });
    if (actor.message) {
      return res.status(actor.status).json({
        success: false,
        message: actor.message
      });
    }

    if (!isVerifiedAuthority(actor.user)) {
      return res.status(403).json({
        success: false,
        message: 'Only verified authority accounts can complete donations via QR token'
      });
    }

    const completionScopeHospitalId = resolveCompletionScopeHospitalId(actor.user);
    const completionMethod = resolveCompletionMethod(actor.user);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [donations] = await connection.execute(
      `SELECT id, donor_id, donation_date, blood_group, units_donated, status
       FROM blood_donations
       WHERE verification_qr_token = ?
         AND (verification_qr_expires_at IS NULL OR verification_qr_expires_at > NOW())
       LIMIT 1
       FOR UPDATE`,
      [verificationQrToken]
    );

    if (donations.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Invalid or expired donation verification token'
      });
    }

    const donation = donations[0];
    if (donation.status === 'Completed') {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Donation is already completed'
      });
    }

    await connection.execute(
      `UPDATE blood_donations
       SET status = 'Completed',
           notes = COALESCE(?, notes),
           completion_verified = TRUE,
           completed_by = ?,
           completion_verified_at = NOW(),
           completion_method = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [notes, actor.user.id, completionMethod, donation.id]
    );

    if (useInventoryHospitalColumn && completionScopeHospitalId !== null) {
      const [inventoryUpdate] = await connection.execute(
        `UPDATE blood_inventory
         SET available_units = available_units + ?
         WHERE blood_group = ? AND hospital_id = ?`,
        [donation.units_donated, donation.blood_group, completionScopeHospitalId]
      );

      if (inventoryUpdate.affectedRows === 0) {
        await connection.execute(
          `INSERT INTO blood_inventory (hospital_id, blood_group, available_units, reserved_units)
           VALUES (?, ?, ?, 0)`,
          [completionScopeHospitalId, donation.blood_group, donation.units_donated]
        );
      }
    } else {
      const [inventoryUpdate] = await connection.execute(
        `UPDATE blood_inventory
         SET available_units = available_units + ?
         WHERE blood_group = ? AND ${useInventoryHospitalColumn ? 'hospital_id IS NULL' : 'TRUE'}`,
        [donation.units_donated, donation.blood_group]
      );

      if (inventoryUpdate.affectedRows === 0) {
        if (useInventoryHospitalColumn) {
          await connection.execute(
            `INSERT INTO blood_inventory (hospital_id, blood_group, available_units, reserved_units)
             VALUES (NULL, ?, ?, 0)`,
            [donation.blood_group, donation.units_donated]
          );
        } else {
          await connection.execute(
            `INSERT INTO blood_inventory (blood_group, available_units, reserved_units)
             VALUES (?, ?, 0)`,
            [donation.blood_group, donation.units_donated]
          );
        }
      }
    }

    await connection.execute(
      'UPDATE users SET last_donation_date = ?, is_donor = TRUE WHERE id = ?',
      [donation.donation_date, donation.donor_id]
    );

    await connection.commit();
    await cacheService.invalidatePrefix('matching:nearby:');

    return res.json({
      success: true,
      message: 'Donation completed with verified QR handshake',
      donation_id: donation.id,
      completion_verified: true,
      completion_method: completionMethod
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Complete donation by token error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to complete donation by token'
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Get all donations
router.get('/all', async (req, res) => {
  try {
    const [donations] = await pool.execute(
      `SELECT bd.*, u.name as donor_name,
              br.patient_name, br.hospital_name
       FROM blood_donations bd 
       LEFT JOIN users u ON bd.donor_id = u.id 
       LEFT JOIN blood_requests br ON bd.request_id = br.id
       ORDER BY bd.created_at DESC`
    );

    res.json({
      success: true,
      donations
    });

  } catch (error) {
    console.error('Get donations error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get donations by donor
router.get('/donor/:donorId', async (req, res) => {
  try {
    const donorId = parsePositiveInt(req.params.donorId);
    if (!donorId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid donor ID'
      });
    }

    const [donations] = await pool.execute(
      `SELECT bd.*, br.patient_name, br.hospital_name
       FROM blood_donations bd 
       LEFT JOIN blood_requests br ON bd.request_id = br.id
       WHERE bd.donor_id = ?
       ORDER BY bd.donation_date DESC`,
      [donorId]
    );

    res.json({
      success: true,
      donations
    });

  } catch (error) {
    console.error('Get donations by donor error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get donations by blood group
router.get('/by-blood-group/:bloodGroup', async (req, res) => {
  try {
    const bloodGroup = normalizeString(req.params.bloodGroup).toUpperCase();
    if (!BLOOD_GROUPS.has(bloodGroup)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blood group'
      });
    }

    const [donations] = await pool.execute(
      `SELECT bd.*, u.name as donor_name
       FROM blood_donations bd 
       LEFT JOIN users u ON bd.donor_id = u.id 
       WHERE bd.blood_group = ? AND bd.status = 'Completed'
       ORDER BY bd.donation_date DESC`,
      [bloodGroup]
    );

    res.json({
      success: true,
      donations
    });

  } catch (error) {
    console.error('Get donations by blood group error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get donation statistics
router.get('/statistics', async (req, res) => {
  try {
    const useDonationVerificationColumns = await hasDonationVerificationColumns();
    const completionFilter = useDonationVerificationColumns
      ? `status = 'Completed' AND completion_verified = TRUE`
      : `status = 'Completed'`;

    // Total donations
    const [totalDonations] = await pool.execute(
      `SELECT COUNT(*) as total
       FROM blood_donations
       WHERE ${completionFilter}`
    );

    // Donations by blood group
    const [donationsByBloodGroup] = await pool.execute(
      `SELECT blood_group, COUNT(*) as count, SUM(units_donated) as total_units
       FROM blood_donations 
       WHERE ${completionFilter}
       GROUP BY blood_group`
    );

    // Recent donations (last 30 days)
    const [recentDonations] = await pool.execute(
      `SELECT COUNT(*) as recent_count 
       FROM blood_donations 
       WHERE ${completionFilter}
       AND donation_date >= (CURRENT_DATE - INTERVAL '30 days')`
    );

    // Top donors
    const [topDonors] = await pool.execute(
      `SELECT u.name, COUNT(bd.id) as donation_count, SUM(bd.units_donated) as total_units
       FROM blood_donations bd
       JOIN users u ON bd.donor_id = u.id
       WHERE ${useDonationVerificationColumns
    ? `bd.status = 'Completed' AND bd.completion_verified = TRUE`
    : `bd.status = 'Completed'`}
       GROUP BY bd.donor_id, u.name
       ORDER BY donation_count DESC
       LIMIT 10`
    );

    res.json({
      success: true,
      statistics: {
        totalDonations: totalDonations[0].total,
        donationsByBloodGroup,
        recentDonations: recentDonations[0].recent_count,
        topDonors,
        verified_only: useDonationVerificationColumns
      }
    });

  } catch (error) {
    console.error('Get donation statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Gamified donor leaderboard
router.get('/superheroes', async (req, res) => {
  try {
    const requestedLimit = parsePositiveInt(req.query.limit);
    const requestedDays = parsePositiveInt(req.query.days);
    const limit = requestedLimit ? Math.min(requestedLimit, 50) : 10;
    const days = requestedDays ? Math.min(requestedDays, 3650) : 180;
    const useDonationVerificationColumns = await hasDonationVerificationColumns();

    const [leaders] = await pool.execute(
      `SELECT
         u.id,
         u.name,
         u.blood_group,
         u.city,
         u.state,
         u.last_donation_date,
         COUNT(bd.id)::INT AS donation_count,
         COALESCE(SUM(bd.units_donated), 0)::INT AS total_units,
         MAX(bd.donation_date) AS latest_donation_date,
         COALESCE(
           SUM(CASE
             WHEN bd.donation_date >= (CURRENT_DATE - (? * INTERVAL '1 day')) THEN bd.units_donated
             ELSE 0
           END),
           0
         )::INT AS active_units
       FROM users u
       JOIN blood_donations bd ON bd.donor_id = u.id
       WHERE u.is_donor = TRUE
         AND ${useDonationVerificationColumns
    ? `bd.status = 'Completed' AND bd.completion_verified = TRUE`
    : `bd.status = 'Completed'`}
       GROUP BY u.id, u.name, u.blood_group, u.city, u.state, u.last_donation_date
       ORDER BY donation_count DESC, active_units DESC, latest_donation_date DESC
       LIMIT ?`,
      [days, limit]
    );

    let source = useDonationVerificationColumns
      ? 'verified_completed_donations'
      : 'completed_donations';
    let rankedLeaders = leaders;

    if (rankedLeaders.length === 0) {
      const [registeredDonors] = await pool.execute(
        `SELECT
           u.id,
           u.name,
           u.blood_group,
           u.city,
           u.state,
           u.last_donation_date,
           0::INT AS donation_count,
           0::INT AS total_units,
           u.last_donation_date AS latest_donation_date,
           0::INT AS active_units
         FROM users u
         WHERE u.is_donor = TRUE
         ORDER BY u.updated_at DESC, u.created_at DESC
         LIMIT ?`,
        [limit]
      );

      source = 'registered_donors';
      rankedLeaders = registeredDonors;
    }

    const withBadges = rankedLeaders.map((leader, index) => {
      let badge = 'Community Hero';
      if (index === 0) {
        badge = 'Legend Hero';
      } else if (index < 3) {
        badge = 'Gold Hero';
      } else if (index < 6) {
        badge = 'Silver Hero';
      }

      return {
        rank: index + 1,
        badge,
        thank_you_note: leader.donation_count > 0
          ? `Special thanks ${leader.name} for saving lives through active donations.`
          : `Thank you ${leader.name} for registering as a donor. Complete your next donation to move up this board.`,
        ...leader
      };
    });

    return res.json({
      success: true,
      period_days: days,
      source,
      superheroes: withBadges
    });
  } catch (error) {
    console.error('Get superheroes leaderboard error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load donor leaderboard'
    });
  }
});

// Cancel a donation
router.put('/:id/cancel', async (req, res) => {
  try {
    const donationId = parsePositiveInt(req.params.id);
    if (!donationId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid donation ID'
      });
    }

    const [result] = await pool.execute(
      `UPDATE blood_donations 
       SET status = 'Cancelled', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status <> 'Completed'`,
      [donationId]
    );

    if (result.affectedRows === 0) {
      const [existing] = await pool.execute(
        'SELECT status FROM blood_donations WHERE id = ?',
        [donationId]
      );

      if (existing.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Donation record not found'
        });
      }

      return res.status(400).json({
        success: false,
        message: `Completed donations cannot be cancelled`
      });
    }

    await cacheService.invalidatePrefix('matching:nearby:');

    res.json({
      success: true,
      message: 'Blood donation cancelled successfully'
    });

  } catch (error) {
    console.error('Cancel donation error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
