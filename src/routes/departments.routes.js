import { query } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { authorizeRoles, ROLES } from '../middleware/rbac.js';

function parseSafeInt(val) {
  if (val === undefined || val === null || val === '' || val === 'undefined' || val === 'null') return null;
  const num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

export default async function departmentRoutes(fastify, options) {
  fastify.addHook('preHandler', authenticate);

  // List all departments with stats
  fastify.get('/', async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;

    const res = await query(
      `SELECT d.*, 
              (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) as user_count,
              (SELECT COUNT(*) FROM requirements r WHERE r.department_id = d.id) as req_count,
              (SELECT COUNT(*) FROM kpis k WHERE k.department_id = d.id) as kpi_count
       FROM departments d
       WHERE d.hospital_id = $1
       ORDER BY d.name ASC`,
      [hospitalId]
    );

    return { departments: res.rows };
  });

  // Create department
  fastify.post('/', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN)] }, async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const { name, code, description, head_of_dept } = request.body || {};

    if (!name || !code) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Name and Code are required' });
    }

    const res = await query(
      `INSERT INTO departments (hospital_id, name, code, description, head_of_dept)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [hospitalId, name, String(code).toUpperCase(), description || '', head_of_dept || '']
    );

    return { department: res.rows[0] };
  });

  // Update department
  fastify.put('/:id', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN)] }, async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer department ID required' });
    }

    const { name, code, description, head_of_dept } = request.body || {};

    const res = await query(
      `UPDATE departments
       SET name = COALESCE($1, name),
           code = COALESCE($2, code),
           description = COALESCE($3, description),
           head_of_dept = COALESCE($4, head_of_dept),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING *`,
      [name || null, code ? String(code).toUpperCase() : null, description || null, head_of_dept || null, id]
    );

    if (res.rows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'Department not found' });
    }

    return { department: res.rows[0] };
  });

  // Delete department
  fastify.delete('/:id', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN)] }, async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer department ID required' });
    }
    await query('DELETE FROM departments WHERE id = $1', [id]);
    return { success: true, message: 'Department deleted successfully' };
  });
}
