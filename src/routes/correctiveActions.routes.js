import { query } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { authorizeRoles, ROLES } from '../middleware/rbac.js';

function parseSafeInt(val) {
  if (val === undefined || val === null || val === '' || val === 'undefined' || val === 'null') return null;
  const num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

export default async function correctiveActionRoutes(fastify, options) {
  fastify.addHook('preHandler', authenticate);

  // List CAPAs
  fastify.get('/', async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const { department_id, status } = request.query || {};

    let sql = `
      SELECT c.*, d.name as department_name, d.code as department_code,
             u.name as assignee_name, v.name as verifier_name,
             f.title as finding_title, f.severity as finding_severity,
             r.code as requirement_code, r.title as requirement_title,
             (SELECT COUNT(*) FROM documents doc WHERE doc.linked_corrective_action_id = c.id) as evidence_count
      FROM corrective_actions c
      LEFT JOIN departments d ON c.department_id = d.id
      LEFT JOIN users u ON c.assigned_to = u.id
      LEFT JOIN users v ON c.verified_by = v.id
      LEFT JOIN audit_findings f ON c.finding_id = f.id
      LEFT JOIN requirements r ON c.requirement_id = r.id
      WHERE c.hospital_id = $1
    `;
    const params = [hospitalId];

    const deptId = parseSafeInt(department_id);
    if (deptId !== null) {
      params.push(deptId);
      sql += ` AND c.department_id = $${params.length}`;
    }
    if (status && status !== 'undefined' && status !== 'null' && status.trim() !== '') {
      params.push(status.trim());
      sql += ` AND c.status = $${params.length}`;
    }

    sql += ' ORDER BY c.due_date ASC';

    const res = await query(sql, params);
    return { correctiveActions: res.rows };
  });

  // Get single CAPA
  fastify.get('/:id', async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer CAPA ID required' });
    }

    const res = await query(
      `SELECT c.*, d.name as department_name, d.code as department_code,
              u.name as assignee_name, v.name as verifier_name,
              f.title as finding_title, f.severity as finding_severity,
              r.code as requirement_code, r.title as requirement_title
       FROM corrective_actions c
       LEFT JOIN departments d ON c.department_id = d.id
       LEFT JOIN users u ON c.assigned_to = u.id
       LEFT JOIN users v ON c.verified_by = v.id
       LEFT JOIN audit_findings f ON c.finding_id = f.id
       LEFT JOIN requirements r ON c.requirement_id = r.id
       WHERE c.id = $1`,
      [id]
    );

    if (res.rows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'Corrective Action not found' });
    }

    const docs = await query(
      `SELECT id, filename, mime_type, file_size, doc_type, expiry_date, uploaded_at 
       FROM documents WHERE linked_corrective_action_id = $1`,
      [id]
    );

    return { correctiveAction: res.rows[0], documents: docs.rows };
  });

  // Create CAPA
  fastify.post('/', async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const { department_id, finding_id, requirement_id, title, root_cause_analysis, action_plan, assigned_to, due_date } = request.body || {};

    if (!title || !due_date) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Title and due date are required' });
    }

    const res = await query(
      `INSERT INTO corrective_actions (hospital_id, department_id, finding_id, requirement_id, title, root_cause_analysis, action_plan, assigned_to, due_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        hospitalId,
        parseSafeInt(department_id),
        parseSafeInt(finding_id),
        parseSafeInt(requirement_id),
        title,
        root_cause_analysis || '',
        action_plan || '',
        parseSafeInt(assigned_to) || parseSafeInt(request.user?.id),
        due_date,
        'Open'
      ]
    );

    return { correctiveAction: res.rows[0] };
  });

  // Update CAPA Status & Workflow
  fastify.put('/:id/status', async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer CAPA ID required' });
    }

    const { status, resolution_notes, verification_notes } = request.body || {};

    if (!status) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Status is required' });
    }

    let sql = 'UPDATE corrective_actions SET status = $1, updated_at = CURRENT_TIMESTAMP';
    const params = [status];

    if (resolution_notes) {
      params.push(resolution_notes);
      sql += `, resolution_notes = $${params.length}`;
    }

    if (status === 'Completed') {
      sql += ', completed_at = CURRENT_TIMESTAMP';
    }

    if (status === 'Verified') {
      params.push(parseSafeInt(request.user?.id));
      sql += `, verified_by = $${params.length}, verified_at = CURRENT_TIMESTAMP`;
      if (verification_notes) {
        params.push(verification_notes);
        sql += `, verification_notes = $${params.length}`;
      }
    }

    params.push(id);
    sql += ` WHERE id = $${params.length} RETURNING *`;

    const res = await query(sql, params);
    if (res.rows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'Corrective Action not found' });
    }

    return { correctiveAction: res.rows[0] };
  });

  // Delete CAPA
  fastify.delete('/:id', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN)] }, async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer CAPA ID required' });
    }
    await query('DELETE FROM corrective_actions WHERE id = $1', [id]);
    return { success: true, message: 'Corrective action deleted successfully' };
  });
}
