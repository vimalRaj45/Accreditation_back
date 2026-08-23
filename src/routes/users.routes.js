import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { authorizeRoles, ROLES } from '../middleware/rbac.js';

function parseSafeInt(val) {
  if (val === undefined || val === null || val === '' || val === 'undefined' || val === 'null') return null;
  const num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

export default async function userRoutes(fastify, options) {
  fastify.addHook('preHandler', authenticate);

  // List users for hospital
  fastify.get('/', async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const { department_id, role } = request.query || {};

    let sql = `
      SELECT u.id, u.hospital_id, u.department_id, u.name, u.email, u.role, u.phone, u.is_active, u.created_at,
             d.name as department_name, d.code as department_code
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.hospital_id = $1
    `;
    const params = [hospitalId];

    const deptId = parseSafeInt(department_id);
    if (deptId !== null) {
      params.push(deptId);
      sql += ` AND u.department_id = $${params.length}`;
    }
    if (role && role !== 'undefined' && role !== 'null' && role.trim() !== '') {
      params.push(role.trim());
      sql += ` AND u.role = $${params.length}`;
    }

    sql += ' ORDER BY u.name ASC';

    const res = await query(sql, params);
    return { users: res.rows };
  });

  // Create user
  fastify.post('/', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN)] }, async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const { department_id, name, email, password, role, phone } = request.body || {};

    if (!name || !email || !password || !role) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Name, email, password, and role are required' });
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [String(email).trim().toLowerCase()]);
    if (existing.rows.length > 0) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Email is already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const res = await query(
      `INSERT INTO users (hospital_id, department_id, name, email, password_hash, role, phone, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, hospital_id, department_id, name, email, role, phone, is_active, created_at`,
      [
        hospitalId,
        parseSafeInt(department_id),
        name,
        String(email).trim().toLowerCase(),
        passwordHash,
        role,
        phone || null,
        true
      ]
    );

    return { user: res.rows[0] };
  });

  // Update user
  fastify.put('/:id', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN)] }, async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer user ID required' });
    }

    const { department_id, name, role, phone, is_active, password } = request.body || {};

    let passwordHash = null;
    if (password && password.trim().length > 0) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    const res = await query(
      `UPDATE users
       SET department_id = COALESCE($1, department_id),
           name = COALESCE($2, name),
           role = COALESCE($3, role),
           phone = COALESCE($4, phone),
           is_active = COALESCE($5, is_active),
           password_hash = COALESCE($6, password_hash),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7
       RETURNING id, hospital_id, department_id, name, email, role, phone, is_active, updated_at`,
      [
        parseSafeInt(department_id),
        name || null,
        role || null,
        phone || null,
        is_active !== undefined ? is_active : null,
        passwordHash,
        id
      ]
    );

    if (res.rows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'User not found' });
    }

    return { user: res.rows[0] };
  });

  // Delete user
  fastify.delete('/:id', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN)] }, async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer user ID required' });
    }
    await query('DELETE FROM users WHERE id = $1', [id]);
    return { success: true, message: 'User deleted successfully' };
  });
}
