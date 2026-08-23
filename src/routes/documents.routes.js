import { query } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { authorizeRoles, ROLES } from '../middleware/rbac.js';

function parseSafeInt(val) {
  if (val === undefined || val === null || val === '' || val === 'undefined' || val === 'null') return null;
  const num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

export default async function documentRoutes(fastify, options) {
  fastify.addHook('preHandler', authenticate);

  // List document metadata (BYTEA payload omitted for performance)
  fastify.get('/', async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const { department_id, doc_type, requirement_id, search } = request.query || {};

    let sql = `
      SELECT doc.id, doc.hospital_id, doc.department_id, doc.filename, doc.mime_type, doc.file_size,
             doc.doc_type, doc.linked_requirement_id, doc.linked_audit_id, doc.linked_corrective_action_id,
             doc.version, doc.tags, doc.expiry_date, doc.uploaded_by, doc.uploaded_at,
             d.name as department_name, d.code as department_code,
             u.name as uploader_name,
             r.code as requirement_code, r.title as requirement_title,
             a.title as audit_title,
             c.title as capa_title
      FROM documents doc
      LEFT JOIN departments d ON doc.department_id = d.id
      LEFT JOIN users u ON doc.uploaded_by = u.id
      LEFT JOIN requirements r ON doc.linked_requirement_id = r.id
      LEFT JOIN audits a ON doc.linked_audit_id = a.id
      LEFT JOIN corrective_actions c ON doc.linked_corrective_action_id = c.id
      WHERE doc.hospital_id = $1
    `;
    const params = [hospitalId];

    const deptId = parseSafeInt(department_id);
    if (deptId !== null) {
      params.push(deptId);
      sql += ` AND doc.department_id = $${params.length}`;
    }
    if (doc_type && doc_type !== 'undefined' && doc_type !== 'null' && doc_type.trim() !== '') {
      params.push(doc_type.trim());
      sql += ` AND doc.doc_type = $${params.length}`;
    }
    const reqId = parseSafeInt(requirement_id);
    if (reqId !== null) {
      params.push(reqId);
      sql += ` AND doc.linked_requirement_id = $${params.length}`;
    }
    if (search && search !== 'undefined' && search !== 'null' && search.trim() !== '') {
      params.push(`%${search.trim()}%`);
      sql += ` AND (doc.filename ILIKE $${params.length} OR doc.tags ILIKE $${params.length})`;
    }

    sql += ' ORDER BY doc.uploaded_at DESC';

    const res = await query(sql, params);
    return { documents: res.rows };
  });

  // Get single document metadata
  fastify.get('/:id', async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer document ID required' });
    }

    const res = await query(
      `SELECT doc.id, doc.hospital_id, doc.department_id, doc.filename, doc.mime_type, doc.file_size,
              doc.doc_type, doc.linked_requirement_id, doc.linked_audit_id, doc.linked_corrective_action_id,
              doc.version, doc.tags, doc.expiry_date, doc.uploaded_by, doc.uploaded_at,
              d.name as department_name, u.name as uploader_name,
              r.code as requirement_code, r.title as requirement_title
       FROM documents doc
       LEFT JOIN departments d ON doc.department_id = d.id
       LEFT JOIN users u ON doc.uploaded_by = u.id
       LEFT JOIN requirements r ON doc.linked_requirement_id = r.id
       WHERE doc.id = $1`,
      [id]
    );

    if (res.rows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });
    }

    return { document: res.rows[0] };
  });

  // Upload document file into PostgreSQL BYTEA BLOB
  fastify.post('/upload', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'Validation Error', message: 'No file was uploaded' });
    }

    const buffer = await data.toBuffer();
    const fields = data.fields || {};

    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const departmentId = parseSafeInt(fields.department_id?.value);
    const docType = fields.doc_type?.value || 'Policy Document';
    const linkedRequirementId = parseSafeInt(fields.linked_requirement_id?.value);
    const linkedAuditId = parseSafeInt(fields.linked_audit_id?.value);
    const linkedCapaId = parseSafeInt(fields.linked_corrective_action_id?.value);
    const version = fields.version?.value || '1.0';
    const tags = fields.tags?.value || '';
    const expiryDate = fields.expiry_date?.value || null;

    const res = await query(
      `INSERT INTO documents (hospital_id, department_id, filename, mime_type, file_size, file_data, doc_type, linked_requirement_id, linked_audit_id, linked_corrective_action_id, version, tags, expiry_date, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, filename, mime_type, file_size, doc_type, linked_requirement_id, version, tags, expiry_date, uploaded_at`,
      [
        hospitalId,
        departmentId,
        data.filename,
        data.mimetype || 'application/octet-stream',
        buffer.length,
        buffer,
        docType,
        linkedRequirementId,
        linkedAuditId,
        linkedCapaId,
        version,
        tags,
        expiryDate,
        parseSafeInt(request.user?.id)
      ]
    );

    return { success: true, document: res.rows[0] };
  });

  // Download document file stream from PostgreSQL BYTEA BLOB
  fastify.get('/:id/download', async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer document ID required' });
    }

    const res = await query(
      'SELECT filename, mime_type, file_data FROM documents WHERE id = $1',
      [id]
    );

    if (res.rows.length === 0 || !res.rows[0].file_data) {
      return reply.status(404).send({ error: 'Not Found', message: 'Document or binary file content not found' });
    }

    const doc = res.rows[0];
    reply.header('Content-Type', doc.mime_type || 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.filename)}"`);
    return reply.send(doc.file_data);
  });

  // Stream inline preview of document from PostgreSQL BYTEA BLOB
  fastify.get('/:id/preview', async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer document ID required' });
    }

    const res = await query(
      'SELECT filename, mime_type, file_data FROM documents WHERE id = $1',
      [id]
    );

    if (res.rows.length === 0 || !res.rows[0].file_data) {
      return reply.status(404).send({ error: 'Not Found', message: 'Document content not found' });
    }

    const doc = res.rows[0];
    reply.header('Content-Type', doc.mime_type || 'application/octet-stream');
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(doc.filename)}"`);
    return reply.send(doc.file_data);
  });

  // Delete document
  fastify.delete('/:id', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN, ROLES.DEPT_HEAD)] }, async (request, reply) => {
    const id = parseSafeInt(request.params.id);
    if (id === null) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Valid integer document ID required' });
    }
    await query('DELETE FROM documents WHERE id = $1', [id]);
    return { success: true, message: 'Document deleted successfully' };
  });
}
