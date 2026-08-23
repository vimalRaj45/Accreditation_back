import { query } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { authorizeRoles, ROLES } from '../middleware/rbac.js';

export default async function hospitalRoutes(fastify, options) {
  fastify.addHook('preHandler', authenticate);

  // Get Hospital details
  fastify.get('/current', async (request, reply) => {
    const hospitalId = request.user.hospital_id || 1;
    const res = await query('SELECT * FROM hospitals WHERE id = $1', [hospitalId]);
    if (res.rows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'Hospital not found' });
    }
    const weights = await query('SELECT * FROM scoring_weights WHERE hospital_id = $1', [hospitalId]);
    return {
      hospital: res.rows[0],
      scoringWeights: weights.rows[0] || { compliance_weight: 0.4, kpi_weight: 0.25, audit_weight: 0.2, evidence_weight: 0.15 }
    };
  });

  // Update Hospital metadata
  fastify.put('/current', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN)] }, async (request, reply) => {
    const hospitalId = request.user.hospital_id || 1;
    const { name, license_number, accreditation_target, address, contact_email } = request.body || {};

    const res = await query(
      `UPDATE hospitals 
       SET name = COALESCE($1, name), license_number = COALESCE($2, license_number),
           accreditation_target = COALESCE($3, accreditation_target), address = COALESCE($4, address),
           contact_email = COALESCE($5, contact_email)
       WHERE id = $6 RETURNING *`,
      [name, license_number, accreditation_target, address, contact_email, hospitalId]
    );

    return { hospital: res.rows[0] };
  });

  // Update Scoring Weights
  fastify.put('/weights', { preHandler: [authorizeRoles(ROLES.SUPER_ADMIN, ROLES.HOSPITAL_ADMIN)] }, async (request, reply) => {
    const hospitalId = request.user.hospital_id || 1;
    const { compliance_weight, kpi_weight, audit_weight, evidence_weight } = request.body || {};

    const sum = (Number(compliance_weight) || 0) + (Number(kpi_weight) || 0) + (Number(audit_weight) || 0) + (Number(evidence_weight) || 0);
    if (Math.abs(sum - 1.0) > 0.01) {
      return reply.status(400).send({ error: 'Validation Error', message: `Weights must sum to 1.0 (Current sum: ${sum.toFixed(2)})` });
    }

    const check = await query('SELECT hospital_id FROM scoring_weights WHERE hospital_id = $1', [hospitalId]);
    if (check.rows.length === 0) {
      await query(
        `INSERT INTO scoring_weights (hospital_id, compliance_weight, kpi_weight, audit_weight, evidence_weight, last_updated)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [hospitalId, compliance_weight, kpi_weight, audit_weight, evidence_weight]
      );
    } else {
      await query(
        `UPDATE scoring_weights
         SET compliance_weight = $1, kpi_weight = $2, audit_weight = $3, evidence_weight = $4, last_updated = CURRENT_TIMESTAMP
         WHERE hospital_id = $5`,
        [compliance_weight, kpi_weight, audit_weight, evidence_weight, hospitalId]
      );
    }

    return {
      success: true,
      message: 'Scoring weights updated successfully',
      weights: { compliance_weight, kpi_weight, audit_weight, evidence_weight }
    };
  });
}
