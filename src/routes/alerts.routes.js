import { query } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { runAlertsSweep } from '../services/cronAlerts.js';

function parseSafeInt(val) {
  if (val === undefined || val === null || val === '' || val === 'undefined' || val === 'null') return null;
  const num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

export default async function alertRoutes(fastify, options) {
  fastify.addHook('preHandler', authenticate);

  // Get notifications for current user/hospital
  fastify.get('/', async (request, reply) => {
    const userId = parseSafeInt(request.user?.id);
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const { unread_only } = request.query || {};

    let sql = `
      SELECT * FROM notifications 
      WHERE (user_id = $1 OR (user_id IS NULL AND hospital_id = $2))
    `;
    const params = [userId, hospitalId];

    if (unread_only === 'true' || unread_only === true) {
      sql += ' AND is_read = FALSE';
    }

    sql += ' ORDER BY created_at DESC LIMIT 50';

    const res = await query(sql, params);
    return { notifications: res.rows };
  });

  // Mark all notifications as read
  fastify.put('/read-all', async (request, reply) => {
    const userId = parseSafeInt(request.user?.id);
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;

    await query(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = $1 OR (user_id IS NULL AND hospital_id = $2)',
      [userId, hospitalId]
    );

    return { success: true, message: 'All notifications marked as read' };
  });

  // Mark single notification as read
  fastify.put('/:id/read', async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer notification ID required' });
    }

    await query('UPDATE notifications SET is_read = TRUE WHERE id = $1', [id]);
    return { success: true, message: 'Notification marked as read' };
  });

  // Trigger manual compliance sweep for alerts & Brevo emails
  fastify.post('/sweep', async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const sweepResult = await runAlertsSweep(hospitalId);
    return {
      success: true,
      message: 'Automated compliance sweep executed successfully',
      ...sweepResult
    };
  });
}
