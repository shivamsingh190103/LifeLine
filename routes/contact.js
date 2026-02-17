const express = require('express');
const nodemailer = require('nodemailer');
const { pool } = require('../config/database');
const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\d{10}$/;
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
const normalizePhone = value => {
  if (value === undefined || value === null) {
    return null;
  }
  const digits = String(value).replace(/\D/g, '');
  return digits || null;
};

const parseBooleanEnv = value => {
  if (value === undefined || value === null) {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const isMailConfigured = () => (
  Boolean(process.env.SMTP_HOST) &&
  Boolean(process.env.SMTP_USER) &&
  Boolean(process.env.SMTP_PASS) &&
  Boolean(process.env.SMTP_FROM)
);

const contactReceiverEmail = () => (
  normalizeString(process.env.CONTACT_RECEIVER_EMAIL) ||
  normalizeString(process.env.SMTP_USER)
);

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

let emailTransporter = null;

const getMailTransporter = () => {
  if (!isMailConfigured()) {
    return null;
  }

  if (emailTransporter) {
    return emailTransporter;
  }

  const parsedPort = Number.parseInt(process.env.SMTP_PORT, 10);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 587;
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

const sendContactNotification = async ({ name, email, phone, message, messageId }) => {
  const receiver = contactReceiverEmail();
  if (!receiver) {
    throw new Error('CONTACT_RECEIVER_EMAIL or SMTP_USER must be configured');
  }

  const transporter = getMailTransporter();
  if (!transporter) {
    throw new Error('SMTP is not configured for contact notifications');
  }

  const submittedAt = new Date().toISOString();

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: receiver,
    replyTo: email,
    subject: `New LifeLine contact message from ${name}`,
    text: `You received a new contact message in LifeLine.

Message ID: ${messageId}
Submitted At: ${submittedAt}
Name: ${name}
Email: ${email}
Phone: ${phone || 'Not provided'}

Message:
${message}
`,
    html: `
      <h2>New LifeLine Contact Message</h2>
      <p><strong>Message ID:</strong> ${escapeHtml(messageId)}</p>
      <p><strong>Submitted At:</strong> ${escapeHtml(submittedAt)}</p>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone || 'Not provided')}</p>
      <p><strong>Message:</strong></p>
      <pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(message)}</pre>
    `
  });
};

// Submit contact message
router.post('/submit', async (req, res) => {
  try {
    const name = normalizeString(req.body.name);
    const email = normalizeString(req.body.email).toLowerCase();
    const message = normalizeString(req.body.message);
    const phone = normalizePhone(req.body.phone);

    // Validate required fields
    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and message are required'
      });
    }

    // Validate email format
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    if (phone !== null && !PHONE_REGEX.test(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must be exactly 10 digits'
      });
    }

    // Insert contact message
    const [result] = await pool.execute(
      `INSERT INTO contact_messages (name, email, phone, message)
       VALUES (?, ?, ?, ?)
       RETURNING id`,
      [name, email, phone, message]
    );

    try {
      await sendContactNotification({
        name,
        email,
        phone,
        message,
        messageId: result.insertId
      });
    } catch (mailError) {
      console.error('Contact notification email error:', mailError);
      return res.status(500).json({
        success: false,
        message: 'Message saved, but email delivery failed. Check SMTP and CONTACT_RECEIVER_EMAIL settings.'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Message sent successfully. We have emailed your support inbox.',
      message_id: result.insertId
    });

  } catch (error) {
    console.error('Submit contact message error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get all contact messages (admin only)
router.get('/all', async (req, res) => {
  try {
    const [messages] = await pool.execute(
      'SELECT * FROM contact_messages ORDER BY created_at DESC'
    );

    res.json({
      success: true,
      messages
    });

  } catch (error) {
    console.error('Get contact messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get unread messages
router.get('/unread', async (req, res) => {
  try {
    const [messages] = await pool.execute(
      `SELECT *
       FROM contact_messages
       WHERE status = 'Unread'
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      messages
    });

  } catch (error) {
    console.error('Get unread messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Mark message as read
router.put('/:id/read', async (req, res) => {
  try {
    const messageId = parsePositiveInt(req.params.id);
    if (!messageId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid message ID'
      });
    }

    const [result] = await pool.execute(
      `UPDATE contact_messages
       SET status = 'Read'
       WHERE id = ?`,
      [messageId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    res.json({
      success: true,
      message: 'Message marked as read'
    });

  } catch (error) {
    console.error('Mark message as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Mark message as replied
router.put('/:id/replied', async (req, res) => {
  try {
    const messageId = parsePositiveInt(req.params.id);
    if (!messageId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid message ID'
      });
    }

    const [result] = await pool.execute(
      `UPDATE contact_messages
       SET status = 'Replied'
       WHERE id = ?`,
      [messageId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    res.json({
      success: true,
      message: 'Message marked as replied'
    });

  } catch (error) {
    console.error('Mark message as replied error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get contact statistics
router.get('/statistics/overview', async (req, res) => {
  try {
    // Total messages
    const [totalMessages] = await pool.execute(
      'SELECT COUNT(*) as total FROM contact_messages'
    );

    // Unread messages
    const [unreadMessages] = await pool.execute(
      `SELECT COUNT(*) as unread
       FROM contact_messages
       WHERE status = 'Unread'`
    );

    // Read messages
    const [readMessages] = await pool.execute(
      `SELECT COUNT(*) as read
       FROM contact_messages
       WHERE status = 'Read'`
    );

    // Replied messages
    const [repliedMessages] = await pool.execute(
      `SELECT COUNT(*) as replied
       FROM contact_messages
       WHERE status = 'Replied'`
    );

    // Recent messages (last 7 days)
    const [recentMessages] = await pool.execute(
      `SELECT COUNT(*) as recent
       FROM contact_messages
       WHERE created_at >= (NOW() - INTERVAL '7 days')`
    );

    res.json({
      success: true,
      statistics: {
        total: totalMessages[0].total,
        unread: unreadMessages[0].unread,
        read: readMessages[0].read,
        replied: repliedMessages[0].replied,
        recent: recentMessages[0].recent
      }
    });

  } catch (error) {
    console.error('Get contact statistics overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get message by ID
router.get('/:id', async (req, res) => {
  try {
    const messageId = parsePositiveInt(req.params.id);
    if (!messageId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid message ID'
      });
    }

    const [messages] = await pool.execute(
      'SELECT * FROM contact_messages WHERE id = ?',
      [messageId]
    );

    if (messages.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    res.json({
      success: true,
      message: messages[0]
    });

  } catch (error) {
    console.error('Get message by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete message
router.delete('/:id', async (req, res) => {
  try {
    const messageId = parsePositiveInt(req.params.id);
    if (!messageId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid message ID'
      });
    }

    const [result] = await pool.execute(
      'DELETE FROM contact_messages WHERE id = ?',
      [messageId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    res.json({
      success: true,
      message: 'Message deleted successfully'
    });

  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
