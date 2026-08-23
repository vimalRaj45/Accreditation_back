import { query } from '../config/db.js';

/**
 * Compliance & Readiness Scoring Engine (Deterministic backend formula)
 * Weighted Formula:
 * - Compliance Requirements Score: 40% (Compliant = 100%, Partially Compliant = 50%, Under Review = 25%, Non-Compliant = 0%, Pending = 0%)
 * - KPI Performance Score: 25% (Green = 100%, Yellow = 50%, Red = 0%)
 * - Audit Findings & Performance Score: 20% (Base 100 minus weighted penalties for Critical, Major, Minor findings)
 * - Document / Evidence Completeness: 15% (Valid unexpired evidence coverage)
 */
export async function calculateHospitalReadiness(hospitalId = 1) {
  // 1. Get Configured Scoring Weights
  const weightRes = await query(
    'SELECT compliance_weight, kpi_weight, audit_weight, evidence_weight FROM scoring_weights WHERE hospital_id = $1',
    [hospitalId]
  );
  const weights = weightRes.rows[0] || {
    compliance_weight: 0.40,
    kpi_weight: 0.25,
    audit_weight: 0.20,
    evidence_weight: 0.15
  };

  const wCompliance = Number(weights.compliance_weight) || 0.40;
  const wKpi = Number(weights.kpi_weight) || 0.25;
  const wAudit = Number(weights.audit_weight) || 0.20;
  const wEvidence = Number(weights.evidence_weight) || 0.15;

  // 2. Calculate Compliance Requirements Score
  const reqRes = await query(
    'SELECT id, status, priority, department_id FROM requirements WHERE hospital_id = $1',
    [hospitalId]
  );
  const requirements = reqRes.rows || [];
  let complianceScore = 0;
  let compliantCount = 0;
  let partialCount = 0;
  let nonCompliantCount = 0;
  let underReviewCount = 0;
  let pendingCount = 0;

  if (requirements.length > 0) {
    let totalPoints = 0;
    requirements.forEach(r => {
      if (r.status === 'Compliant') {
        totalPoints += 100;
        compliantCount++;
      } else if (r.status === 'Partially Compliant') {
        totalPoints += 50;
        partialCount++;
      } else if (r.status === 'Under Review') {
        totalPoints += 25;
        underReviewCount++;
      } else if (r.status === 'Non-Compliant') {
        nonCompliantCount++;
      } else {
        pendingCount++;
      }
    });
    complianceScore = Math.round((totalPoints / (requirements.length * 100)) * 100);
  }

  // 3. Calculate KPI Performance Score
  const kpiRes = await query(
    'SELECT id, status, target_value, actual_value, department_id FROM kpis WHERE hospital_id = $1',
    [hospitalId]
  );
  const kpis = kpiRes.rows || [];
  let kpiScore = 0;
  let greenKpi = 0;
  let yellowKpi = 0;
  let redKpi = 0;

  if (kpis.length > 0) {
    let kpiPoints = 0;
    kpis.forEach(k => {
      if (k.status === 'Green') {
        kpiPoints += 100;
        greenKpi++;
      } else if (k.status === 'Yellow') {
        kpiPoints += 50;
        yellowKpi++;
      } else {
        redKpi++;
      }
    });
    kpiScore = Math.round((kpiPoints / (kpis.length * 100)) * 100);
  }

  // 4. Calculate Audit & Findings Score
  const auditsRes = await query(
    'SELECT id, score, status FROM audits WHERE hospital_id = $1',
    [hospitalId]
  );
  const audits = auditsRes.rows || [];
  const findingsRes = await query(
    `SELECT af.severity, af.status 
     FROM audit_findings af 
     JOIN audits a ON af.audit_id = a.id 
     WHERE a.hospital_id = $1`,
    [hospitalId]
  );
  const findings = findingsRes.rows || [];

  let auditScore = 80; // Baseline if no audits yet
  let criticalFindings = 0;
  let majorFindings = 0;
  let minorFindings = 0;

  findings.forEach(f => {
    if (f.severity === 'Critical') criticalFindings++;
    else if (f.severity === 'Major') majorFindings++;
    else minorFindings++;
  });

  if (audits.length > 0) {
    const completedAudits = audits.filter(a => a.status === 'Completed');
    if (completedAudits.length > 0) {
      const avgCompletedScore = completedAudits.reduce((acc, a) => acc + (Number(a.score) || 0), 0) / completedAudits.length;
      // Deduct penalty for active unresolved critical/major findings
      const openCritical = findings.filter(f => f.severity === 'Critical' && f.status !== 'Resolved').length;
      const openMajor = findings.filter(f => f.severity === 'Major' && f.status !== 'Resolved').length;
      const penalty = (openCritical * 10) + (openMajor * 4);
      auditScore = Math.max(0, Math.min(100, Math.round(avgCompletedScore - penalty)));
    }
  }

  // 5. Calculate Document & Evidence Completeness Score
  const docsRes = await query(
    'SELECT id, expiry_date, linked_requirement_id FROM documents WHERE hospital_id = $1',
    [hospitalId]
  );
  const docs = docsRes.rows || [];
  const now = new Date();
  let validDocsCount = 0;
  let expiredDocsCount = 0;

  docs.forEach(d => {
    if (d.expiry_date && new Date(d.expiry_date) < now) {
      expiredDocsCount++;
    } else {
      validDocsCount++;
    }
  });

  // Calculate evidence coverage ratio across total requirements
  const totalReqCount = Math.max(requirements.length, 1);
  const reqsWithDocs = new Set(docs.filter(d => d.linked_requirement_id).map(d => d.linked_requirement_id)).size;
  const coverageRatio = reqsWithDocs / totalReqCount;
  const evidenceScore = Math.round(Math.min(100, coverageRatio * 100));

  // 6. Calculate Overall Readiness Score (Deterministic Weighted Sum)
  const overallReadinessScore = Math.round(
    (complianceScore * wCompliance) +
    (kpiScore * wKpi) +
    (auditScore * wAudit) +
    (evidenceScore * wEvidence)
  );

  // Status designation
  let readinessGrade = 'High Risk';
  let gradeColor = 'red';
  if (overallReadinessScore >= 85) {
    readinessGrade = 'Accreditation Ready';
    gradeColor = 'emerald';
  } else if (overallReadinessScore >= 70) {
    readinessGrade = 'Substantial Compliance';
    gradeColor = 'amber';
  } else if (overallReadinessScore >= 50) {
    readinessGrade = 'Needs Significant Remediation';
    gradeColor = 'orange';
  }

  // 7. Department-wise Breakdown
  const deptRes = await query(
    'SELECT id, name, code FROM departments WHERE hospital_id = $1 ORDER BY name ASC',
    [hospitalId]
  );
  const departments = deptRes.rows || [];
  const departmentBreakdown = departments.map(dept => {
    const deptReqs = requirements.filter(r => Number(r.department_id) === Number(dept.id));
    const deptKpis = kpis.filter(k => Number(k.department_id) === Number(dept.id));
    
    let deptCompScore = 0;
    if (deptReqs.length > 0) {
      const pts = deptReqs.reduce((acc, r) => {
        if (r.status === 'Compliant') return acc + 100;
        if (r.status === 'Partially Compliant') return acc + 50;
        if (r.status === 'Under Review') return acc + 25;
        return acc;
      }, 0);
      deptCompScore = Math.round(pts / deptReqs.length);
    }

    let deptKpiScore = 0;
    if (deptKpis.length > 0) {
      const pts = deptKpis.reduce((acc, k) => {
        if (k.status === 'Green') return acc + 100;
        if (k.status === 'Yellow') return acc + 50;
        return acc;
      }, 0);
      deptKpiScore = Math.round(pts / deptKpis.length);
    }

    const deptReadiness = Math.round((deptCompScore * 0.6) + (deptKpiScore * 0.4));

    return {
      id: dept.id,
      departmentId: dept.id,
      name: dept.name,
      code: dept.code,
      requirementsCount: deptReqs.length,
      complianceScore: deptCompScore,
      kpiCount: deptKpis.length,
      kpiScore: deptKpiScore,
      readinessScore: deptReadiness
    };
  });

  return {
    hospitalId,
    overallReadinessScore,
    readinessGrade,
    gradeColor,
    weights: {
      compliance: wCompliance,
      kpi: wKpi,
      audit: wAudit,
      evidence: wEvidence
    },
    scores: {
      compliance: complianceScore,
      kpi: kpiScore,
      audit: auditScore,
      evidence: evidenceScore
    },
    counts: {
      requirements: {
        total: requirements.length,
        compliant: compliantCount,
        partiallyCompliant: partialCount,
        nonCompliant: nonCompliantCount,
        underReview: underReviewCount,
        pending: pendingCount
      },
      kpis: {
        total: kpis.length,
        green: greenKpi,
        yellow: yellowKpi,
        red: redKpi
      },
      audits: {
        total: audits.length,
        completed: audits.filter(a => a.status === 'Completed').length,
        inProgress: audits.filter(a => a.status === 'In Progress').length,
        scheduled: audits.filter(a => a.status === 'Scheduled').length
      },
      findings: {
        total: findings.length,
        critical: criticalFindings,
        major: majorFindings,
        minor: minorFindings
      },
      evidence: {
        total: docs.length,
        valid: validDocsCount,
        expired: expiredDocsCount,
        coveragePercent: Math.round(coverageRatio * 100)
      }
    },
    departmentBreakdown,
    calculatedAt: new Date().toISOString()
  };
}

export default {
  calculateHospitalReadiness
};
