import { query } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { authorizeRoles, ROLES } from '../middleware/rbac.js';

function parseSafeInt(val) {
  if (val === undefined || val === null || val === '' || val === 'undefined' || val === 'null') return null;
  const num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

function computeKpiStatus(target, actual, name = '') {
  const targetVal = Number(target) || 0;
  const actualVal = Number(actual) || 0;
  const lower = String(name || '').toLowerCase();

  const isLowerBetter = lower.includes('error') || lower.includes('rate') || lower.includes('time') || lower.includes('cauti') || lower.includes('clabsi') || lower.includes('incident');

  if (isLowerBetter) {
    if (actualVal <= targetVal) return 'Green';
    if (actualVal <= targetVal * 1.25) return 'Yellow';
    return 'Red';
  } else {
    if (actualVal >= targetVal) return 'Green';
    if (actualVal >= targetVal * 0.85) return 'Yellow';
    return 'Red';
  }
}

export default async function kpiRoutes(fastify, options) {
  fastify.addHook('preHandler', authenticate);

  // List KPIs with filters
  fastify.get('/', async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const { department_id, status, category } = request.query || {};

    let sql = `
      SELECT k.*, d.name as department_name, d.code as department_code, u.name as updated_by_name
      FROM kpis k
      LEFT JOIN departments d ON k.department_id = d.id
      LEFT JOIN users u ON k.updated_by = u.id
      WHERE k.hospital_id = $1
    `;
    const params = [hospitalId];

    const deptId = parseSafeInt(department_id);
    if (deptId !== null) {
      params.push(deptId);
      sql += ` AND k.department_id = $${params.length}`;
    }
    if (status && status !== 'undefined' && status !== 'null' && status.trim() !== '') {
      params.push(status.trim());
      sql += ` AND k.status = $${params.length}`;
    }
    if (category && category !== 'undefined' && category !== 'null' && category.trim() !== '') {
      params.push(category.trim());
      sql += ` AND k.category = $${params.length}`;
    }

    sql += ' ORDER BY k.status DESC, k.name ASC';

    const res = await query(sql, params);
    return { kpis: res.rows };
  });

  // Create KPI
  fastify.post('/', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN, ROLES.DEPT_HEAD)] }, async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const { department_id, name, code, category, target_value, actual_value, unit, frequency, calculation_formula } = request.body || {};

    if (!name || !code || target_value === undefined) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Name, code, and target value are required' });
    }

    const currentActual = actual_value !== undefined ? Number(actual_value) : 0;
    const status = computeKpiStatus(target_value, currentActual, name);

    const res = await query(
      `INSERT INTO kpis (hospital_id, department_id, name, code, category, target_value, actual_value, unit, frequency, status, calculation_formula, updated_by, last_updated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP) RETURNING *`,
      [
        hospitalId,
        parseSafeInt(department_id),
        name,
        String(code).toUpperCase(),
        category || 'Clinical Quality',
        Number(target_value),
        currentActual,
        unit || '%',
        frequency || 'Monthly',
        status,
        calculation_formula || '',
        parseSafeInt(request.user?.id)
      ]
    );

    return { kpi: res.rows[0] };
  });

  // Update KPI actual value & recalculate status
  fastify.put('/:id', async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer KPI ID required' });
    }

    const { actual_value, target_value, name, code, category, unit, frequency, calculation_formula } = request.body || {};

    const current = await query('SELECT * FROM kpis WHERE id = $1', [id]);
    if (current.rows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'KPI not found' });
    }

    const existing = current.rows[0];
    const newTarget = target_value !== undefined ? Number(target_value) : existing.target_value;
    const newActual = actual_value !== undefined ? Number(actual_value) : existing.actual_value;
    const kpiName = name || existing.name;
    const newStatus = computeKpiStatus(newTarget, newActual, kpiName);

    const res = await query(
      `UPDATE kpis
       SET name = COALESCE($1, name),
           code = COALESCE($2, code),
           category = COALESCE($3, category),
           target_value = $4,
           actual_value = $5,
           unit = COALESCE($6, unit),
           frequency = COALESCE($7, frequency),
           status = $8,
           calculation_formula = COALESCE($9, calculation_formula),
           updated_by = $10,
           last_updated = CURRENT_TIMESTAMP
       WHERE id = $11 RETURNING *`,
      [
        name || null,
        code ? String(code).toUpperCase() : null,
        category || null,
        newTarget,
        newActual,
        unit || null,
        frequency || null,
        newStatus,
        calculation_formula || null,
        parseSafeInt(request.user?.id),
        id
      ]
    );

    return { kpi: res.rows[0] };
  });

  // Delete KPI
  fastify.delete('/:id', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN)] }, async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer KPI ID required' });
    }
    await query('DELETE FROM kpis WHERE id = $1', [id]);
    return { success: true, message: 'KPI deleted successfully' };
  });
}
