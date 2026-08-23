import { query } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { authorizeRoles, ROLES } from '../middleware/rbac.js';

function parseSafeInt(val) {
  if (val === undefined || val === null || val === '' || val === 'undefined' || val === 'null') return null;
  const num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

export default async function requirementRoutes(fastify, options) {
  fastify.addHook('preHandler', authenticate);

  // List all requirements with filters
  fastify.get('/', async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const { standard, department_id, status, priority, search } = request.query || {};

    let sql = `
      SELECT r.*, d.name as department_name, d.code as department_code, u.name as assignee_name,
             (SELECT COUNT(*) FROM documents doc WHERE doc.linked_requirement_id = r.id) as evidence_count
      FROM requirements r
      LEFT JOIN departments d ON r.department_id = d.id
      LEFT JOIN users u ON r.assigned_to = u.id
      WHERE r.hospital_id = $1
    `;
    const params = [hospitalId];

    if (standard && standard !== 'undefined' && standard !== 'null' && standard.trim() !== '') {
      params.push(standard.trim());
      sql += ` AND r.standard = $${params.length}`;
    }

    const deptId = parseSafeInt(department_id);
    if (deptId !== null) {
      params.push(deptId);
      sql += ` AND r.department_id = $${params.length}`;
    }

    if (status && status !== 'undefined' && status !== 'null' && status.trim() !== '') {
      params.push(status.trim());
      sql += ` AND r.status = $${params.length}`;
    }

    if (priority && priority !== 'undefined' && priority !== 'null' && priority.trim() !== '') {
      params.push(priority.trim());
      sql += ` AND r.priority = $${params.length}`;
    }

    if (search && search !== 'undefined' && search !== 'null' && search.trim() !== '') {
      params.push(`%${search.trim()}%`);
      sql += ` AND (r.title ILIKE $${params.length} OR r.code ILIKE $${params.length} OR r.chapter ILIKE $${params.length})`;
    }

    sql += ' ORDER BY r.code ASC, r.created_at DESC';

    const res = await query(sql, params);
    return { requirements: res.rows };
  });

  // Get requirement by ID
  fastify.get('/:id', async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer requirement ID required' });
    }

    const res = await query(
      `SELECT r.*, d.name as department_name, d.code as department_code, u.name as assignee_name
       FROM requirements r
       LEFT JOIN departments d ON r.department_id = d.id
       LEFT JOIN users u ON r.assigned_to = u.id
       WHERE r.id = $1`,
      [id]
    );

    if (res.rows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'Requirement not found' });
    }

    const docs = await query(
      `SELECT id, filename, mime_type, file_size, doc_type, expiry_date, uploaded_at 
       FROM documents WHERE linked_requirement_id = $1`,
      [id]
    );

    return { requirement: res.rows[0], documents: docs.rows };
  });

  // Create requirement
  fastify.post('/', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN, ROLES.DEPT_HEAD, ROLES.AUDITOR)] }, async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const { department_id, standard, chapter, code, title, description, status, priority, due_date, assigned_to } = request.body || {};

    if (!standard || !code || !title) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Standard, Code and Title are required' });
    }

    let complianceScore = 0;
    if (status === 'Compliant') complianceScore = 100;
    else if (status === 'Partially Compliant') complianceScore = 50;
    else if (status === 'Under Review') complianceScore = 25;

    const res = await query(
      `INSERT INTO requirements (hospital_id, department_id, standard, chapter, code, title, description, status, priority, due_date, assigned_to, compliance_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        hospitalId,
        parseSafeInt(department_id),
        standard,
        chapter || 'General',
        String(code).toUpperCase(),
        title,
        description || '',
        status || 'Pending',
        priority || 'Medium',
        due_date || null,
        parseSafeInt(assigned_to),
        complianceScore
      ]
    );

    return { requirement: res.rows[0] };
  });

  // Bulk Import Requirements
  fastify.post('/bulk', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN)] }, async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const { requirements = [], standard = 'NABH 5th Edition' } = request.body || {};

    if (!Array.isArray(requirements) || requirements.length === 0) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Requirements list array is required' });
    }

    let insertedCount = 0;
    for (const req of requirements) {
      if (req.code && req.title) {
        await query(
          `INSERT INTO requirements (hospital_id, department_id, standard, chapter, code, title, description, status, priority, due_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            hospitalId,
            parseSafeInt(req.department_id),
            standard || req.standard || 'Accreditation Standard',
            req.chapter || 'Quality Chapter',
            String(req.code).toUpperCase(),
            req.title,
            req.description || '',
            req.status || 'Pending',
            req.priority || 'Medium',
            req.due_date || null
          ]
        );
        insertedCount++;
      }
    }

    return { success: true, insertedCount, message: `Successfully imported ${insertedCount} requirements.` };
  });

  // Update requirement status & details
  fastify.put('/:id', async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer requirement ID required' });
    }

    const { department_id, standard, chapter, code, title, description, status, priority, due_date, assigned_to } = request.body || {};

    let complianceScore = null;
    if (status) {
      if (status === 'Compliant') complianceScore = 100;
      else if (status === 'Partially Compliant') complianceScore = 50;
      else if (status === 'Under Review') complianceScore = 25;
      else complianceScore = 0;
    }

    const res = await query(
      `UPDATE requirements
       SET department_id = COALESCE($1, department_id),
           standard = COALESCE($2, standard),
           chapter = COALESCE($3, chapter),
           code = COALESCE($4, code),
           title = COALESCE($5, title),
           description = COALESCE($6, description),
           status = COALESCE($7, status),
           priority = COALESCE($8, priority),
           due_date = COALESCE($9, due_date),
           assigned_to = $10,
           compliance_score = COALESCE($11, compliance_score),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $12 RETURNING *`,
      [
        parseSafeInt(department_id),
        standard || null,
        chapter || null,
        code ? String(code).toUpperCase() : null,
        title || null,
        description || null,
        status || null,
        priority || null,
        due_date || null,
        parseSafeInt(assigned_to),
        complianceScore,
        id
      ]
    );

    if (res.rows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'Requirement not found' });
    }

    return { requirement: res.rows[0] };
  });

  // Delete requirement
  fastify.delete('/:id', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN)] }, async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer requirement ID required' });
    }
    await query('DELETE FROM requirements WHERE id = $1', [id]);
    return { success: true, message: 'Requirement deleted successfully' };
  });
}
