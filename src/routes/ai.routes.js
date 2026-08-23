import { authenticate } from '../middleware/auth.js';
import { calculateHospitalReadiness } from '../services/scoringService.js';
import {
  analyzeHospitalRisk,
  classifyAuditFinding,
  extractRequirementsFromText,
  extractDocumentMetadata,
  generateManagementSummary,
  generateImprovementRecommendations
} from '../services/mistralAi.js';
import { query } from '../config/db.js';

function parseSafeInt(val) {
  if (val === undefined || val === null || val === '' || val === 'undefined' || val === 'null') return null;
  const num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

export default async function aiRoutes(fastify, options) {
  fastify.addHook('preHandler', authenticate);

  // 1. AI Risk Analysis (from aggregated structured metrics, not raw DB dumps)
  fastify.post('/risk-analysis', async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const readiness = await calculateHospitalReadiness(hospitalId);

    const overdueCapaRes = await query(
      "SELECT COUNT(*) FROM corrective_actions WHERE hospital_id = $1 AND due_date < CURRENT_DATE AND status NOT IN ('Completed', 'Verified')",
      [hospitalId]
    );
    const overdueCapaCount = Number(overdueCapaRes.rows[0]?.count || 0);

    const analysis = await analyzeHospitalRisk({
      complianceScore: readiness.scores.compliance,
      kpiScore: readiness.scores.kpi,
      auditScore: readiness.scores.audit,
      evidenceScore: readiness.scores.evidence,
      readinessScore: readiness.overallReadinessScore,
      nonCompliantCount: readiness.counts.requirements.nonCompliant,
      criticalFindingsCount: readiness.counts.findings.critical,
      redKpiCount: readiness.counts.kpis.red,
      overdueCapaCount
    });

    return { success: true, ...analysis, readinessScores: readiness.scores };
  });

  // 2. AI Audit Finding Classification (Severity + Category + Suggested Action)
  fastify.post('/classify-finding', async (request, reply) => {
    const { title, description, departmentName } = request.body || {};

    if (!title || !description) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Observation title and description are required' });
    }

    const classification = await classifyAuditFinding({ title, description, departmentName });
    return { success: true, ...classification };
  });

  // 3. AI Requirement Extraction from Pasted / Uploaded Standards
  fastify.post('/extract-requirements', async (request, reply) => {
    const { text, standardName } = request.body || {};

    if (!text || text.trim().length < 10) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Standard regulatory text content is required' });
    }

    const extracted = await extractRequirementsFromText({ text, standardName: standardName || 'NABH 5th Edition' });
    return { success: true, ...extracted };
  });

  // 4. AI Document / Evidence Field Extraction
  fastify.post('/extract-document-metadata', async (request, reply) => {
    const { filename, textSnippet, fileSize } = request.body || {};

    if (!filename) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Filename is required' });
    }

    const metadata = await extractDocumentMetadata({ filename, textSnippet, fileSize });
    return { success: true, ...metadata };
  });

  // 5. AI Management Summary Paragraph Generation
  fastify.post('/management-summary', async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const hospRes = await query('SELECT name FROM hospitals WHERE id = $1', [hospitalId]);
    const hospitalName = hospRes.rows[0]?.name || 'Metro Apex Super Specialty Hospital';

    const readiness = await calculateHospitalReadiness(hospitalId);

    const findingsRes = await query(
      "SELECT af.title, af.severity FROM audit_findings af JOIN audits a ON af.audit_id = a.id WHERE a.hospital_id = $1 AND af.severity = 'Critical' LIMIT 3",
      [hospitalId]
    );

    const summary = await generateManagementSummary({
      hospitalName,
      overallReadinessScore: readiness.overallReadinessScore,
      complianceScore: readiness.scores.compliance,
      kpiScore: readiness.scores.kpi,
      auditScore: readiness.scores.audit,
      evidenceScore: readiness.scores.evidence,
      topRisks: findingsRes.rows.map(f => f.title)
    });

    return { success: true, ...summary, readinessScore: readiness.overallReadinessScore };
  });

  // 6. AI Improvement Recommendations Generator
  fastify.post('/improvement-recommendations', async (request, reply) => {
    const hospitalId = parseSafeInt(request.user?.hospital_id) || 1;
    const readiness = await calculateHospitalReadiness(hospitalId);

    const redKpis = await query("SELECT name, code, target_value, actual_value, unit FROM kpis WHERE hospital_id = $1 AND status != 'Green'", [hospitalId]);
    const findings = await query("SELECT af.title, af.severity, af.category FROM audit_findings af JOIN audits a ON af.audit_id = a.id WHERE a.hospital_id = $1 LIMIT 5", [hospitalId]);

    const recs = await generateImprovementRecommendations({
      readinessScore: readiness.overallReadinessScore,
      lowestComplianceChapters: ['MOM High Alert Drugs', 'Emergency Code Blue Protocols'],
      redKpis: redKpis.rows,
      openCriticalFindings: findings.rows
    });

    return { success: true, ...(recs.recommendations ? recs : { recommendations: recs }) };
  });
}
