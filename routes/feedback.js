const express = require('express');
const { pool } = require('../config/database');

const router = express.Router();

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

const parseRating = value => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
};

const normalizeCategory = value => {
  const normalized = normalizeString(value);
  if (!normalized) {
    return 'General';
  }
  return normalized.slice(0, 50);
};

router.post('/submit', async (req, res) => {
  try {
    const userId = parsePositiveInt(req.body.user_id);
    const rating = parseRating(req.body.rating);
    const category = normalizeCategory(req.body.category);
    const feedbackText = optionalStringOrNull(req.body.feedback_text);

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Valid user_id is required to submit a rating'
      });
    }

    if (!rating) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be an integer between 1 and 5'
      });
    }

    const [users] = await pool.execute('SELECT id FROM users WHERE id = ? LIMIT 1', [userId]);
    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const [existingFeedback] = await pool.execute(
      `SELECT id
       FROM app_feedback
       WHERE user_id = ?
       ORDER BY updated_at DESC NULLS LAST, created_at DESC, id DESC
       LIMIT 1`,
      [userId]
    );

    if (existingFeedback.length > 0) {
      const feedbackId = existingFeedback[0].id;
      const [updateResult] = await pool.execute(
        `UPDATE app_feedback
         SET rating = ?, category = ?, feedback_text = ?, updated_at = NOW()
         WHERE id = ?
         RETURNING id`,
        [rating, category, feedbackText, feedbackId]
      );

      await pool.execute(
        'DELETE FROM app_feedback WHERE user_id = ? AND id <> ?',
        [userId, feedbackId]
      );

      return res.json({
        success: true,
        action: 'updated',
        message: 'Your rating was updated successfully.',
        feedback_id: updateResult.insertId
      });
    }

    const [insertResult] = await pool.execute(
      `INSERT INTO app_feedback (user_id, rating, category, feedback_text)
       VALUES (?, ?, ?, ?)
       RETURNING id`,
      [userId, rating, category, feedbackText]
    );

    return res.status(201).json({
      success: true,
      action: 'created',
      message: 'Thank you for your feedback.',
      feedback_id: insertResult.insertId
    });
  } catch (error) {
    console.error('Submit feedback error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit feedback'
    });
  }
});

router.get('/user/:userId', async (req, res) => {
  try {
    const userId = parsePositiveInt(req.params.userId);
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    const [feedback] = await pool.execute(
      `SELECT id, user_id, rating, category, feedback_text, created_at, updated_at
       FROM app_feedback
       WHERE user_id = ?
       ORDER BY updated_at DESC NULLS LAST, created_at DESC, id DESC
       LIMIT 1`,
      [userId]
    );

    return res.json({
      success: true,
      feedback: feedback[0] || null
    });
  } catch (error) {
    console.error('Get user feedback error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load user feedback'
    });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const [totals] = await pool.execute(
      `WITH ranked_feedback AS (
         SELECT
           af.id,
           af.rating,
           af.created_at,
           af.updated_at,
           ROW_NUMBER() OVER (
             PARTITION BY COALESCE(af.user_id, -af.id)
             ORDER BY af.updated_at DESC NULLS LAST, af.created_at DESC, af.id DESC
           ) AS rn
         FROM app_feedback af
       )
       SELECT
         COUNT(*)::INT AS total_feedback,
         COALESCE(ROUND(AVG(rating)::numeric, 2), 0) AS average_rating
       FROM ranked_feedback
       WHERE rn = 1`
    );

    const [distribution] = await pool.execute(
      `WITH ranked_feedback AS (
         SELECT
           af.id,
           af.rating,
           af.created_at,
           af.updated_at,
           ROW_NUMBER() OVER (
             PARTITION BY COALESCE(af.user_id, -af.id)
             ORDER BY af.updated_at DESC NULLS LAST, af.created_at DESC, af.id DESC
           ) AS rn
         FROM app_feedback af
       )
       SELECT rating, COUNT(*)::INT AS count
       FROM ranked_feedback
       WHERE rn = 1
       GROUP BY rating
       ORDER BY rating DESC`
    );

    const [recentTrend] = await pool.execute(
      `WITH ranked_feedback AS (
         SELECT
           af.id,
           af.rating,
           af.created_at,
           af.updated_at,
           ROW_NUMBER() OVER (
             PARTITION BY COALESCE(af.user_id, -af.id)
             ORDER BY af.updated_at DESC NULLS LAST, af.created_at DESC, af.id DESC
           ) AS rn
         FROM app_feedback af
       )
       SELECT COALESCE(ROUND(AVG(rating)::numeric, 2), 0) AS average_rating_30d
       FROM ranked_feedback
       WHERE rn = 1
         AND created_at >= NOW() - INTERVAL '30 days'`
    );

    const bucketTemplate = {
      5: 0,
      4: 0,
      3: 0,
      2: 0,
      1: 0
    };

    for (const row of distribution) {
      bucketTemplate[row.rating] = row.count;
    }

    return res.json({
      success: true,
      summary: {
        total_feedback: totals[0].total_feedback,
        average_rating: Number.parseFloat(totals[0].average_rating || 0),
        average_rating_30d: Number.parseFloat(recentTrend[0].average_rating_30d || 0),
        distribution: bucketTemplate
      }
    });
  } catch (error) {
    console.error('Feedback summary error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load feedback summary'
    });
  }
});

router.get('/recent', async (req, res) => {
  try {
    const requestedLimit = parsePositiveInt(req.query.limit);
    const limit = requestedLimit ? Math.min(requestedLimit, 50) : 10;

    const [feedback] = await pool.execute(
      `WITH ranked_feedback AS (
         SELECT
           af.id,
           af.user_id,
           af.rating,
           af.category,
           af.feedback_text,
           af.created_at,
           af.updated_at,
           ROW_NUMBER() OVER (
             PARTITION BY COALESCE(af.user_id, -af.id)
             ORDER BY af.updated_at DESC NULLS LAST, af.created_at DESC, af.id DESC
           ) AS rn
         FROM app_feedback af
       )
       SELECT rf.id, rf.rating, rf.category, rf.feedback_text, rf.created_at,
              u.id AS user_id, u.name AS user_name
       FROM ranked_feedback rf
       LEFT JOIN users u ON rf.user_id = u.id
       WHERE rf.rn = 1
       ORDER BY COALESCE(rf.updated_at, rf.created_at) DESC
       LIMIT ?`,
      [limit]
    );

    return res.json({
      success: true,
      feedback
    });
  } catch (error) {
    console.error('Recent feedback error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load recent feedback'
    });
  }
});

module.exports = router;
