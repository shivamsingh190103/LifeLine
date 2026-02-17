const express = require('express');
const { pool } = require('../config/database');
const cacheService = require('../services/cache');
const alertStream = require('../services/alertStream');
const { parseLatitude, parseLongitude } = require('../services/geo');
const { resolveActorUser, isVerifiedAuthority } = require('../services/accessControl');
const router = express.Router();

const BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const URGENCY_LEVELS = new Set(['Low', 'Medium', 'High', 'Emergency']);
const REQUEST_STATUSES = new Set(['Pending', 'In Progress', 'Completed', 'Cancelled']);
const REQUEST_VERIFICATION_STATUSES = new Set(['Not Required', 'Pending Verification', 'Verified', 'Rejected']);

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

const requestVerificationColumnsState = {
  checked: false,
  available: false
};

const hasRequestVerificationColumns = async () => {
  if (requestVerificationColumnsState.checked) {
    return requestVerificationColumnsState.available;
  }

  try {
    const [columns] = await pool.execute(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'blood_requests'
         AND column_name IN (
           'verification_required',
           'verification_status',
           'requisition_image_url',
           'verified_by',
           'verified_at',
           'verification_notes',
           'call_room_url',
           'call_room_created_at'
         )`
    );

    const requiredColumns = new Set([
      'verification_required',
      'verification_status',
      'requisition_image_url',
      'verified_by',
      'verified_at',
      'verification_notes',
      'call_room_url',
      'call_room_created_at'
    ]);

    const foundColumns = new Set(columns.map(column => column.column_name));
    requestVerificationColumnsState.available = Array.from(requiredColumns).every(column => foundColumns.has(column));
  } catch (error) {
    requestVerificationColumnsState.available = false;
  } finally {
    requestVerificationColumnsState.checked = true;
  }

  return requestVerificationColumnsState.available;
};

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
      requisition_image_url = null,
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
    const normalizedRequisitionImageUrl = optionalStringOrNull(requisition_image_url);
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

    const useVerificationColumns = await hasRequestVerificationColumns();
    const requiresVerification = useVerificationColumns &&
      (normalizedUrgencyLevel === 'High' || normalizedUrgencyLevel === 'Emergency');

    // Insert blood request
    let result;
    if (useVerificationColumns) {
      [result] = await pool.execute(
        `INSERT INTO blood_requests 
         (requester_id, patient_name, blood_group, units_required, hospital_name, 
          hospital_address, urgency_level, contact_person, contact_phone, reason, required_date,
          verification_required, verification_status, requisition_image_url) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
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
          normalizedRequiredDate,
          requiresVerification,
          requiresVerification ? 'Pending Verification' : 'Not Required',
          normalizedRequisitionImageUrl
        ]
      );
    } else {
      [result] = await pool.execute(
        `INSERT INTO blood_requests 
         (requester_id, patient_name, blood_group, units_required, hospital_name, 
          hospital_address, urgency_level, contact_person, contact_phone, reason, required_date) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
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
    }

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
        if (error.code !== 'ER_BAD_FIELD_ERROR' && error.code !== '42703') {
          throw error;
        }
      }
    }

    let alertsSent = 0;
    if (
      !requiresVerification &&
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
      message: requiresVerification
        ? 'Blood request created and is pending medical verification.'
        : 'Blood request created successfully',
      request_id: result.insertId,
      alerts_sent: alertsSent,
      verification_required: requiresVerification,
      verification_status: requiresVerification ? 'Pending Verification' : 'Not Required'
    });

  } catch (error) {
    console.error('Create blood request error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// List pending medically-verified requests (for doctors/hospitals/blood banks)
router.get('/pending-verification', async (req, res) => {
  try {
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
        message: 'Only verified hospital, blood bank, doctor, or admin accounts can view pending verifications'
      });
    }

    const useVerificationColumns = await hasRequestVerificationColumns();
    if (!useVerificationColumns) {
      return res.status(503).json({
        success: false,
        message: 'Verification workflow is not enabled yet. Run `npm run setup`.'
      });
    }

    const [requests] = await pool.execute(
      `SELECT br.*, u.name AS requester_name, u.phone AS requester_phone, u.email AS requester_email
       FROM blood_requests br
       LEFT JOIN users u ON br.requester_id = u.id
       WHERE br.verification_required = TRUE
         AND br.verification_status = 'Pending Verification'
         AND br.status IN ('Pending', 'In Progress')
       ORDER BY br.created_at ASC`
    );

    return res.json({
      success: true,
      requests
    });
  } catch (error) {
    console.error('Get pending verification requests error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load pending verification requests'
    });
  }
});

// Approve/reject high-priority request and trigger broadcast once verified
router.post('/:id/verify-broadcast', async (req, res) => {
  try {
    const requestId = parsePositiveInt(req.params.id);
    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request ID'
      });
    }

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
        message: 'Only verified hospital, blood bank, doctor, or admin accounts can verify requests'
      });
    }

    const useVerificationColumns = await hasRequestVerificationColumns();
    if (!useVerificationColumns) {
      return res.status(503).json({
        success: false,
        message: 'Verification workflow is not enabled yet. Run `npm run setup`.'
      });
    }

    const approveInput = req.body.approve;
    const approve = approveInput === undefined
      ? true
      : Boolean(
        approveInput === true ||
        approveInput === 1 ||
        approveInput === '1' ||
        String(approveInput).toLowerCase() === 'true'
      );
    const verificationNotes = optionalStringOrNull(req.body.verification_notes || req.body.notes);

    const [requestRows] = await pool.execute(
      `SELECT id, requester_id, patient_name, blood_group, units_required, urgency_level,
              hospital_name, required_date, status, verification_required, verification_status
       FROM blood_requests
       WHERE id = ?
       LIMIT 1`,
      [requestId]
    );

    if (requestRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    const bloodRequest = requestRows[0];
    if (!REQUEST_STATUSES.has(bloodRequest.status) || (bloodRequest.status !== 'Pending' && bloodRequest.status !== 'In Progress')) {
      return res.status(400).json({
        success: false,
        message: `Request cannot be verified in ${bloodRequest.status} state`
      });
    }

    if (!bloodRequest.verification_required) {
      return res.status(400).json({
        success: false,
        message: 'This request does not require verification'
      });
    }

    if (!REQUEST_VERIFICATION_STATUSES.has(bloodRequest.verification_status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request verification status'
      });
    }

    if (bloodRequest.verification_status === 'Verified' && approve) {
      return res.status(400).json({
        success: false,
        message: 'Request is already verified'
      });
    }

    const verificationStatus = approve ? 'Verified' : 'Rejected';
    await pool.execute(
      `UPDATE blood_requests
       SET verification_status = ?,
           verified_by = ?,
           verified_at = NOW(),
           verification_notes = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [verificationStatus, actor.user.id, verificationNotes, requestId]
    );

    if (!approve) {
      return res.json({
        success: true,
        message: 'Blood request marked as rejected',
        verification_status: verificationStatus,
        alerts_sent: 0
      });
    }

    let requestLatitude = null;
    let requestLongitude = null;
    if (bloodRequest.requester_id) {
      const [requesterRows] = await pool.execute(
        'SELECT latitude, longitude FROM users WHERE id = ?',
        [bloodRequest.requester_id]
      );

      if (requesterRows.length > 0) {
        requestLatitude = requesterRows[0].latitude === null
          ? null
          : Number.parseFloat(requesterRows[0].latitude);
        requestLongitude = requesterRows[0].longitude === null
          ? null
          : Number.parseFloat(requesterRows[0].longitude);
      }
    }

    let alertsSent = 0;
    if (
      (bloodRequest.urgency_level === 'High' || bloodRequest.urgency_level === 'Emergency') &&
      requestLatitude !== null &&
      requestLongitude !== null
    ) {
      alertsSent = alertStream.broadcastEmergencyAlert({
        requestId: bloodRequest.id,
        bloodGroup: bloodRequest.blood_group,
        latitude: requestLatitude,
        longitude: requestLongitude,
        radiusKm: bloodRequest.urgency_level === 'Emergency' ? 5 : 10,
        payload: {
          patient_name: bloodRequest.patient_name,
          urgency_level: bloodRequest.urgency_level,
          units_required: bloodRequest.units_required,
          hospital_name: bloodRequest.hospital_name,
          required_date: bloodRequest.required_date,
          verified_by: actor.user.name
        }
      });
    }

    return res.json({
      success: true,
      message: 'Blood request verified and broadcast completed',
      verification_status: verificationStatus,
      alerts_sent: alertsSent
    });
  } catch (error) {
    console.error('Verify and broadcast request error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify and broadcast request'
    });
  }
});

// Generate free Jitsi call link without exposing personal phone numbers
router.post('/:id/call-link', async (req, res) => {
  try {
    const requestId = parsePositiveInt(req.params.id);
    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request ID'
      });
    }

    const actor = await resolveActorUser(req, { required: true });
    if (actor.message) {
      return res.status(actor.status).json({
        success: false,
        message: actor.message
      });
    }

    const useVerificationColumns = await hasRequestVerificationColumns();
    if (!useVerificationColumns) {
      return res.status(503).json({
        success: false,
        message: 'Call-link workflow is not enabled yet. Run `npm run setup`.'
      });
    }

    const [requests] = await pool.execute(
      'SELECT id, requester_id FROM blood_requests WHERE id = ? LIMIT 1',
      [requestId]
    );

    if (requests.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    const bloodRequest = requests[0];
    const [donationMatches] = await pool.execute(
      `SELECT id
       FROM blood_donations
       WHERE request_id = ? AND donor_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [requestId, actor.user.id]
    );

    const isParticipant = actor.user.id === bloodRequest.requester_id || donationMatches.length > 0 || isVerifiedAuthority(actor.user);
    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'Only verified participants can generate call links for this request'
      });
    }

    const roomName = `LifeLine-Call-${requestId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const callUrl = `https://meet.jit.si/${roomName}`;

    await pool.execute(
      `UPDATE blood_requests
       SET call_room_url = ?, call_room_created_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [callUrl, requestId]
    );

    return res.json({
      success: true,
      message: 'Call link generated successfully',
      request_id: requestId,
      call_url: callUrl
    });
  } catch (error) {
    console.error('Generate call link error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate call link'
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

    const useVerificationColumns = await hasRequestVerificationColumns();
    const [requests] = await pool.execute(
      `SELECT br.*, u.name as requester_name, u.email as requester_email 
       FROM blood_requests br 
       LEFT JOIN users u ON br.requester_id = u.id 
       WHERE br.blood_group = ? AND br.status = 'Pending'
       ${useVerificationColumns
    ? `AND (br.verification_required = FALSE OR br.verification_status = 'Verified')`
    : ''}
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

    const useVerificationColumns = await hasRequestVerificationColumns();

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

    if (useVerificationColumns) {
      query += ` AND (br.verification_required = FALSE OR br.verification_status = 'Verified')`;
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
    const useVerificationColumns = await hasRequestVerificationColumns();
    const [requests] = await pool.execute(
      `SELECT br.*, u.name as requester_name, u.email as requester_email 
       FROM blood_requests br 
       LEFT JOIN users u ON br.requester_id = u.id 
       WHERE br.urgency_level IN ('High', 'Emergency')
         AND br.status = 'Pending'
         ${useVerificationColumns
    ? `AND (br.verification_required = FALSE OR br.verification_status = 'Verified')`
    : ''}
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
