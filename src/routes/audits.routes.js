import { query } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { authorizeRoles, ROLES } from '../middleware/rbac.js';

function parseSafeInt(val) {
  if (val === undefined || val === null || val === '' || val === 'undefined' || val === 'null') return null;
  const num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

export default async function auditRoutes(fastify, options) {
  fastify.addHook('preHandler', authenticate);

  // List audits
  fastify.get('/', async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const { department_id, status, audit_type } = request.query || {};

    let sql = `
      SELECT a.*, d.name as department_name, d.code as department_code, u.name as lead_auditor_name,
             (SELECT COUNT(*) FROM audit_findings f WHERE f.audit_id = a.id) as findings_count,
             (SELECT COUNT(*) FROM audit_findings f WHERE f.audit_id = a.id AND f.severity = 'Critical') as critical_count
      FROM audits a
      LEFT JOIN departments d ON a.department_id = d.id
      LEFT JOIN users u ON a.lead_auditor_id = u.id
      WHERE a.hospital_id = $1
    `;
    const params = [hospitalId];

    const deptId = parseSafeInt(department_id);
    if (deptId !== null) {
      params.push(deptId);
      sql += ` AND a.department_id = $${params.length}`;
    }
    if (status && status !== 'undefined' && status !== 'null' && status.trim() !== '') {
      params.push(status.trim());
      sql += ` AND a.status = $${params.length}`;
    }
    if (audit_type && audit_type !== 'undefined' && audit_type !== 'null' && audit_type.trim() !== '') {
      params.push(audit_type.trim());
      sql += ` AND a.audit_type = $${params.length}`;
    }

    sql += ' ORDER BY a.scheduled_date DESC';

    const res = await query(sql, params);
    return { audits: res.rows };
  });

  // Get audit by ID with findings
  fastify.get('/:id', async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer audit ID required' });
    }

    const res = await query(
      `SELECT a.*, d.name as department_name, d.code as department_code, u.name as lead_auditor_name
       FROM audits a
       LEFT JOIN departments d ON a.department_id = d.id
       LEFT JOIN users u ON a.lead_auditor_id = u.id
       WHERE a.id = $1`,
      [id]
    );

    if (res.rows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'Audit not found' });
    }

    const findings = await query(
      `SELECT f.*, r.code as requirement_code, r.title as requirement_title,
              c.id as capa_id, c.status as capa_status
       FROM audit_findings f
       LEFT JOIN requirements r ON f.requirement_id = r.id
       LEFT JOIN corrective_actions c ON c.finding_id = f.id
       WHERE f.audit_id = $1
       ORDER BY f.created_at DESC`,
      [id]
    );

    return { audit: res.rows[0], findings: findings.rows };
  });

  // Create audit
  fastify.post('/', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN, ROLES.AUDITOR)] }, async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const { department_id, title, audit_type, scheduled_date, lead_auditor_id, summary, score } = request.body || {};

    if (!title || !scheduled_date) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Title and scheduled date are required' });
    }

    const res = await query(
      `INSERT INTO audits (hospital_id, department_id, title, audit_type, scheduled_date, lead_auditor_id, summary, status, score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        hospitalId,
        parseSafeInt(department_id),
        title,
        audit_type || 'Internal Mock Audit',
        scheduled_date,
        parseSafeInt(lead_auditor_id) || parseSafeInt(request.user?.id),
        summary || '',
        'Scheduled',
        score !== undefined ? Number(score) : 100.0
      ]
    );

    return { audit: res.rows[0] };
  });

  // Update audit
  fastify.put('/:id', async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer audit ID required' });
    }

    const { department_id, title, audit_type, scheduled_date, completed_date, lead_auditor_id, summary, status, score } = request.body || {};

    const res = await query(
      `UPDATE audits
       SET department_id = COALESCE($1, department_id),
           title = COALESCE($2, title),
           audit_type = COALESCE($3, audit_type),
           scheduled_date = COALESCE($4, scheduled_date),
           completed_date = COALESCE($5, completed_date),
           lead_auditor_id = COALESCE($6, lead_auditor_id),
           summary = COALESCE($7, summary),
           status = COALESCE($8, status),
           score = COALESCE($9, score)
       WHERE id = $10 RETURNING *`,
      [
        parseSafeInt(department_id),
        title || null,
        audit_type || null,
        scheduled_date || null,
        completed_date || null,
        parseSafeInt(lead_auditor_id),
        summary || null,
        status || null,
        score !== undefined ? Number(score) : null,
        id
      ]
    );

    return { audit: res.rows[0] };
  });

  // Add finding to audit
  fastify.post('/:id/findings', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN, ROLES.AUDITOR)] }, async (request, reply) => {
    const auditId = parseSafeInt(request.params.id);
    if (auditId === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer audit ID required' });
    }

    const { requirement_id, title, description, severity, category, suggested_action, create_capa, assigned_to, due_date } = request.body || {};

    if (!title || !severity) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Title and severity are required' });
    }

    const auditRes = await query('SELECT hospital_id, department_id FROM audits WHERE id = $1', [auditId]);
    if (auditRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'Audit not found' });
    }

    const audit = auditRes.rows[0];

    const findingRes = await query(
      `INSERT INTO audit_findings (audit_id, requirement_id, title, description, severity, category, suggested_action, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        auditId,
        parseSafeInt(requirement_id),
        title,
        description || '',
        severity,
        category || 'Documentation',
        suggested_action || '',
        'Open'
      ]
    );

    const finding = findingRes.rows[0];
    let createdCapa = null;

    if (create_capa) {
      const capaRes = await query(
        `INSERT INTO corrective_actions (hospital_id, department_id, finding_id, requirement_id, title, root_cause_analysis, action_plan, assigned_to, due_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          audit.hospital_id,
          audit.department_id,
          finding.id,
          parseSafeInt(requirement_id),
          `CAPA: ${title}`,
          'Pending root cause analysis.',
          suggested_action || 'Implement corrective and preventive interventions.',
          parseSafeInt(assigned_to) || parseSafeInt(request.user?.id),
          due_date || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          'Open'
        ]
      );
      createdCapa = capaRes.rows[0];
    }

    return { finding, capa: createdCapa };
  });

  // Update audit finding
  fastify.put('/findings/:findingId', async (request, reply) => {
    const findingId = parseSafeInt(request.params.findingId);
    if (findingId === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer finding ID required' });
    }

    const { title, description, severity, category, suggested_action, status } = request.body || {};

    const res = await query(
      `UPDATE audit_findings
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           severity = COALESCE($3, severity),
           category = COALESCE($4, category),
           suggested_action = COALESCE($5, suggested_action),
           status = COALESCE($6, status)
       WHERE id = $7 RETURNING *`,
      [
        title || null,
        description || null,
        severity || null,
        category || null,
        suggested_action || null,
        status || null,
        findingId
      ]
    );

    return { finding: res.rows[0] };
  });

  // Delete audit
  fastify.delete('/:id', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN)] }, async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer audit ID required' });
    }
    await query('DELETE FROM audits WHERE id = $1', [id]);
    return { success: true, message: 'Audit deleted successfully' };
  });
}
