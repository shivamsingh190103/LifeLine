const express = require('express');
const { pool } = require('../config/database');
const cacheService = require('../services/cache');
const alertStream = require('../services/alertStream');
const { parseLatitude, parseLongitude } = require('../services/geo');
const router = express.Router();

const BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const URGENCY_LEVELS = new Set(['Low', 'Medium', 'High', 'Emergency']);
const REQUEST_STATUSES = new Set(['Pending', 'In Progress', 'Completed', 'Cancelled']);

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
const parseBoundedFloat = (value, fallback, min, max) => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < min) {
    return min;
  }
  if (parsed > max) {
    return max;
  }
  return parsed;
};
const isIsoDate = value => (
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
);

// Create a new blood request
router.post('/create', async (req, res) => {
  try {
    const {
      requester_id,
      patient_name,
      blood_group,
      units_required,
      hospital_name = null,
      hospital_address = null,
      urgency_level = 'Medium',
      contact_person = null,
      contact_phone = null,
      reason = null,
      required_date = null,
      latitude = null,
      longitude = null,
      search_radius_km = 5
    } = req.body;

    const normalizedPatientName = normalizeString(patient_name);
    const normalizedBloodGroup = normalizeString(blood_group).toUpperCase();
    const normalizedUnitsRequired = parsePositiveInt(units_required);
    const normalizedRequesterId = requester_id === undefined || requester_id === null || requester_id === ''
      ? null
      : parsePositiveInt(requester_id);
    const normalizedHospitalName = optionalStringOrNull(hospital_name);
    const normalizedHospitalAddress = optionalStringOrNull(hospital_address);
    const normalizedUrgencyLevel = normalizeString(urgency_level) || 'Medium';
    const normalizedContactPerson = optionalStringOrNull(contact_person);
    const normalizedContactPhone = optionalStringOrNull(contact_phone);
    const normalizedReason = optionalStringOrNull(reason);
    const normalizedRequiredDate = required_date ? normalizeString(required_date) : null;
    const parsedLatitude = parseLatitude(latitude, false);
    const parsedLongitude = parseLongitude(longitude, false);
    const normalizedSearchRadiusKm = parseBoundedFloat(search_radius_km, 5, 1, 50);

    if (parsedLatitude.error || parsedLongitude.error) {
      return res.status(400).json({
        success: false,
        message: parsedLatitude.error || parsedLongitude.error
      });
    }

    // Validate required fields
    if (!normalizedPatientName || !normalizedBloodGroup || !normalizedUnitsRequired) {
      return res.status(400).json({
        success: false,
        message: 'Patient name, blood group, and units required are mandatory'
      });
    }

    if (!BLOOD_GROUPS.has(normalizedBloodGroup)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blood group'
      });
    }

    if (!URGENCY_LEVELS.has(normalizedUrgencyLevel)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid urgency level'
      });
    }

    if (normalizedRequesterId === null && requester_id) {
      return res.status(400).json({
        success: false,
        message: 'Invalid requester ID'
      });
    }

    if (normalizedRequiredDate && !isIsoDate(normalizedRequiredDate)) {
      return res.status(400).json({
        success: false,
        message: 'required_date must be in YYYY-MM-DD format'
      });
    }

    // Insert blood request
    const [result] = await pool.execute(
      `INSERT INTO blood_requests 
       (requester_id, patient_name, blood_group, units_required, hospital_name, 
        hospital_address, urgency_level, contact_person, contact_phone, reason, required_date) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizedRequesterId,
        normalizedPatientName,
        normalizedBloodGroup,
        normalizedUnitsRequired,
        normalizedHospitalName,
        normalizedHospitalAddress,
        normalizedUrgencyLevel,
        normalizedContactPerson,
        normalizedContactPhone,
        normalizedReason,
        normalizedRequiredDate
      ]
    );

    await cacheService.invalidatePrefix('matching:nearby:');

    let requestLatitude = parsedLatitude.value;
    let requestLongitude = parsedLongitude.value;
    if ((requestLatitude === null || requestLongitude === null) && normalizedRequesterId) {
      try {
        const [requesterRows] = await pool.execute(
          'SELECT latitude, longitude FROM users WHERE id = ?',
          [normalizedRequesterId]
        );

        if (requesterRows.length > 0) {
          if (requestLatitude === null && requesterRows[0].latitude !== null) {
            requestLatitude = Number.parseFloat(requesterRows[0].latitude);
          }
          if (requestLongitude === null && requesterRows[0].longitude !== null) {
            requestLongitude = Number.parseFloat(requesterRows[0].longitude);
          }
        }
      } catch (error) {
        if (error.code !== 'ER_BAD_FIELD_ERROR') {
          throw error;
        }
      }
    }

    let alertsSent = 0;
    if (
      (normalizedUrgencyLevel === 'High' || normalizedUrgencyLevel === 'Emergency') &&
      requestLatitude !== null &&
      requestLongitude !== null
    ) {
      alertsSent = alertStream.broadcastEmergencyAlert({
        requestId: result.insertId,
        bloodGroup: normalizedBloodGroup,
        latitude: requestLatitude,
        longitude: requestLongitude,
        radiusKm: normalizedUrgencyLevel === 'Emergency' ? 5 : normalizedSearchRadiusKm,
        payload: {
          patient_name: normalizedPatientName,
          urgency_level: normalizedUrgencyLevel,
          units_required: normalizedUnitsRequired,
          hospital_name: normalizedHospitalName,
          required_date: normalizedRequiredDate
        }
      });
    }

    res.status(201).json({
      success: true,
      message: 'Blood request created successfully',
      request_id: result.insertId,
      alerts_sent: alertsSent
    });

  } catch (error) {
    console.error('Create blood request error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get all blood requests
router.get('/all', async (req, res) => {
  try {
    const [requests] = await pool.execute(
      `SELECT br.*, u.name as requester_name, u.email as requester_email 
       FROM blood_requests br 
       LEFT JOIN users u ON br.requester_id = u.id 
       ORDER BY br.created_at DESC`
    );

    res.json({
      success: true,
      requests
    });

  } catch (error) {
    console.error('Get blood requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get blood requests by blood group
router.get('/by-blood-group/:bloodGroup', async (req, res) => {
  try {
    const bloodGroup = normalizeString(req.params.bloodGroup).toUpperCase();
    if (!BLOOD_GROUPS.has(bloodGroup)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid blood group'
      });
    }

    const [requests] = await pool.execute(
      `SELECT br.*, u.name as requester_name, u.email as requester_email 
       FROM blood_requests br 
       LEFT JOIN users u ON br.requester_id = u.id 
       WHERE br.blood_group = ? AND br.status = 'Pending'
       ORDER BY br.urgency_level DESC, br.created_at DESC`,
      [bloodGroup]
    );

    res.json({
      success: true,
      requests
    });

  } catch (error) {
    console.error('Get blood requests by blood group error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get blood requests by location
router.get('/by-location', async (req, res) => {
  try {
    const city = normalizeString(req.query.city);
    const state = normalizeString(req.query.state);

    let query = `SELECT br.*, u.name as requester_name, u.email as requester_email 
                 FROM blood_requests br 
                 LEFT JOIN users u ON br.requester_id = u.id 
                 WHERE br.status = 'Pending'`;
    let params = [];

    if (city) {
      query += ` AND u.city = ?`;
      params.push(city);
    }

    if (state) {
      query += ` AND u.state = ?`;
      params.push(state);
    }

    query += ` ORDER BY br.urgency_level DESC, br.created_at DESC`;

    const [requests] = await pool.execute(query, params);

    res.json({
      success: true,
      requests
    });

  } catch (error) {
    console.error('Get blood requests by location error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get urgent blood requests
router.get('/urgent/all', async (req, res) => {
  try {
    const [requests] = await pool.execute(
      `SELECT br.*, u.name as requester_name, u.email as requester_email 
       FROM blood_requests br 
       LEFT JOIN users u ON br.requester_id = u.id 
       WHERE br.urgency_level IN ('High', 'Emergency') AND br.status = 'Pending'
       ORDER BY br.urgency_level DESC, br.created_at ASC`
    );

    res.json({
      success: true,
      requests
    });

  } catch (error) {
    console.error('Get urgent blood requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get blood request by ID
router.get('/:id', async (req, res) => {
  try {
    const requestId = parsePositiveInt(req.params.id);
    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request ID'
      });
    }

    const [requests] = await pool.execute(
      `SELECT br.*, u.name as requester_name, u.email as requester_email, u.phone as requester_phone 
       FROM blood_requests br 
       LEFT JOIN users u ON br.requester_id = u.id 
       WHERE br.id = ?`,
      [requestId]
    );

    if (requests.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    res.json({
      success: true,
      request: requests[0]
    });

  } catch (error) {
    console.error('Get blood request by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update blood request status
router.put('/:id/status', async (req, res) => {
  try {
    const requestId = parsePositiveInt(req.params.id);
    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request ID'
      });
    }

    const status = normalizeString(req.body.status);

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    if (!REQUEST_STATUSES.has(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed values: ${Array.from(REQUEST_STATUSES).join(', ')}`
      });
    }

    const [result] = await pool.execute(
      'UPDATE blood_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, requestId]
    );

    await cacheService.invalidatePrefix('matching:nearby:');

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    res.json({
      success: true,
      message: 'Blood request status updated successfully'
    });

  } catch (error) {
    console.error('Update blood request status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete blood request
router.delete('/:id', async (req, res) => {
  try {
    const requestId = parsePositiveInt(req.params.id);
    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request ID'
      });
    }

    const [result] = await pool.execute(
      'DELETE FROM blood_requests WHERE id = ?',
      [requestId]
    );

    await cacheService.invalidatePrefix('matching:nearby:');

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    res.json({
      success: true,
      message: 'Blood request deleted successfully'
    });

  } catch (error) {
    console.error('Delete blood request error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
