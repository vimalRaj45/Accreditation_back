import { authenticate } from '../middleware/auth.js';
import { query } from '../config/db.js';
import { calculateHospitalReadiness } from '../services/scoringService.js';
import { generateManagementSummary } from '../services/mistralAi.js';
import { generateCompliancePdfReport, generateCsvExport } from '../services/pdfReportService.js';

export default async function reportRoutes(fastify, options) {
  fastify.addHook('preHandler', authenticate);

  // Generate and Stream PDF Accreditation & Compliance Report
  fastify.get('/pdf', async (request, reply) => {
    const hospitalId = request.user.hospital_id || 1;

    const hospRes = await query('SELECT * FROM hospitals WHERE id = $1', [hospitalId]);
    const hospital = hospRes.rows[0] || { name: 'Hospital' };

    const readinessData = await calculateHospitalReadiness(hospitalId);

    const reqRes = await query('SELECT * FROM requirements WHERE hospital_id = $1 ORDER BY code ASC', [hospitalId]);
    const kpiRes = await query('SELECT * FROM kpis WHERE hospital_id = $1 ORDER BY status ASC', [hospitalId]);
    const auditRes = await query('SELECT * FROM audits WHERE hospital_id = $1 ORDER BY scheduled_date DESC', [hospitalId]);
    const capaRes = await query(
      `SELECT ca.*, d.name as dept_name, u.name as assignee_name 
       FROM corrective_actions ca 
       LEFT JOIN departments d ON ca.department_id = d.id 
       LEFT JOIN users u ON ca.assigned_to = u.id
       WHERE ca.hospital_id = $1 ORDER BY ca.due_date ASC`,
      [hospitalId]
    );

    const aiSummary = await generateManagementSummary({
      hospitalName: hospital.name,
      overallReadinessScore: readinessData.overallReadinessScore,
      complianceScore: readinessData.scores.compliance,
      kpiScore: readinessData.scores.kpi,
      auditScore: readinessData.scores.audit,
      evidenceScore: readinessData.scores.evidence
    });

    const pdfBuffer = await generateCompliancePdfReport({
      hospital,
      readinessData,
      requirements: reqRes.rows,
      kpis: kpiRes.rows,
      audits: auditRes.rows,
      capas: capaRes.rows,
      aiSummary
    });

    const filename = `Hospital_Accreditation_Report_${new Date().toISOString().split('T')[0]}.pdf`;
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Length', pdfBuffer.length);

    return reply.send(pdfBuffer);
  });

  // Export CSV Reports (requirements, kpis, audits, capa)
  fastify.get('/csv', async (request, reply) => {
    const hospitalId = request.user.hospital_id || 1;
    const { type } = request.query || {};

    let csvContent = '';
    let filename = `report_${type || 'data'}_${new Date().toISOString().split('T')[0]}.csv`;

    if (type === 'requirements') {
      const res = await query('SELECT * FROM requirements WHERE hospital_id = $1 ORDER BY code ASC', [hospitalId]);
      csvContent = generateCsvExport(res.rows, 'requirements');
      filename = `Accreditation_Requirements_${new Date().toISOString().split('T')[0]}.csv`;
    } else if (type === 'kpis') {
      const res = await query('SELECT * FROM kpis WHERE hospital_id = $1 ORDER BY code ASC', [hospitalId]);
      csvContent = generateCsvExport(res.rows, 'kpis');
      filename = `KPI_Performance_Scorecard_${new Date().toISOString().split('T')[0]}.csv`;
    } else if (type === 'audits') {
      const res = await query('SELECT * FROM audits WHERE hospital_id = $1 ORDER BY scheduled_date DESC', [hospitalId]);
      csvContent = generateCsvExport(res.rows, 'audits');
      filename = `Hospital_Audits_Summary_${new Date().toISOString().split('T')[0]}.csv`;
    } else if (type === 'capa') {
      const res = await query(
        `SELECT ca.*, u.name as assignee_name 
         FROM corrective_actions ca 
         LEFT JOIN users u ON ca.assigned_to = u.id
         WHERE ca.hospital_id = $1 ORDER BY ca.due_date ASC`,
        [hospitalId]
      );
      csvContent = generateCsvExport(res.rows, 'capa');
      filename = `Corrective_Actions_CAPA_${new Date().toISOString().split('T')[0]}.csv`;
    } else {
      return reply.status(400).send({ error: 'Bad Request', message: 'Valid type required: requirements, kpis, audits, capa' });
    }

    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);

    return reply.send(csvContent);
  });
}
