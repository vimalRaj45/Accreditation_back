import bcrypt from 'bcryptjs';
import { initDb, query, getMockStore, isUsingMock } from '../config/db.js';

export async function seedDatabase() {
  console.log('🌱 Seeding Hospital Accreditation & Compliance Database...');
  await initDb();

  const passwordHash = await bcrypt.hash('Password123!', 10);

  // 1. Seed Hospital
  const hospCheck = await query('SELECT id FROM hospitals LIMIT 1');
  if (hospCheck.rows.length > 0) {
    console.log('✅ Database already seeded with hospital accreditation dataset. Ready.');
    return;
  }

  const hospRes = await query(
    `INSERT INTO hospitals (name, code, license_number, accreditation_target, address, contact_email) 
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      'Metro Apex Super Specialty Hospital',
      'APEX-001',
      'MED-LIC-2026-9842',
      'NABH 5th Edition & JCI 7th Edition',
      '742 Healthcare Boulevard, Medical Enclave',
      'compliance@metroapex.org'
    ]
  );
  const hospitalId = hospRes.rows[0]?.id || 1;

  // 2. Seed Scoring Weights
  const weightsCheck = await query('SELECT hospital_id FROM scoring_weights WHERE hospital_id = $1', [hospitalId]);
  if (weightsCheck.rows.length === 0) {
    await query(
      `INSERT INTO scoring_weights (hospital_id, compliance_weight, kpi_weight, audit_weight, evidence_weight)
       VALUES ($1, $2, $3, $4, $5)`,
      [hospitalId, 0.40, 0.25, 0.20, 0.15]
    );
  }

  // 3. Seed Departments
  const departmentsData = [
    { name: 'Quality & Patient Safety', code: 'QPS', head: 'Dr. Rajesh Sharma', desc: 'Clinical quality indicators, patient safety incidents, NABH compliance' },
    { name: 'Emergency & Critical Care', code: 'ECC', head: 'Dr. Anita Desai', desc: 'ER triage, ICU clinical protocols, resuscitation workflows' },
    { name: 'Hospital Infection Control', code: 'HIC', head: 'Dr. Vikram Patel', desc: 'HAI surveillance, hand hygiene compliance, sterile processing' },
    { name: 'Pharmacy & Therapeutics', code: 'PHARM', head: 'Mr. David Wilson', desc: 'High-alert medications, LASA drugs, adverse drug reaction monitoring' },
    { name: 'Nursing Services', code: 'NURS', head: 'Ms. Sarah Jenkins', desc: 'Nursing care plans, medication administration, fall prevention' },
    { name: 'Facility & Safety Management', code: 'FMS', head: 'Eng. Robert Chang', desc: 'Fire safety, medical gas pipeline, hazardous waste management' }
  ];

  const deptMap = {};
  for (const d of departmentsData) {
    const existing = await query('SELECT id FROM departments WHERE hospital_id = $1 AND code = $2', [hospitalId, d.code]);
    if (existing.rows.length === 0) {
      const res = await query(
        `INSERT INTO departments (hospital_id, name, code, head_name, description)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [hospitalId, d.name, d.code, d.head, d.desc]
      );
      deptMap[d.code] = res.rows[0]?.id || Object.keys(deptMap).length + 1;
    } else {
      deptMap[d.code] = existing.rows[0].id;
    }
  }

  // 4. Seed Users (5 Standard RBAC Roles)
  const usersData = [
    {
      name: 'Dr. Arthur Pendelton',
      email: 'superadmin@medicare.org',
      role: 'Super Admin',
      dept: null,
      phone: '+1-555-0100'
    },
    {
      name: 'Dr. Rajesh Sharma',
      email: 'admin@medicare.org',
      role: 'Hospital Admin',
      dept: deptMap['QPS'],
      phone: '+1-555-0101'
    },
    {
      name: 'Dr. Anita Desai',
      email: 'depthead@medicare.org',
      role: 'Department Head',
      dept: deptMap['ECC'],
      phone: '+1-555-0102'
    },
    {
      name: 'Auditor James Vance',
      email: 'auditor@medicare.org',
      role: 'Auditor',
      dept: null,
      phone: '+1-555-0103'
    },
    {
      name: 'Nurse Mary Higgins',
      email: 'staff@medicare.org',
      role: 'Staff',
      dept: deptMap['NURS'],
      phone: '+1-555-0104'
    }
  ];

  const userMap = {};
  for (const u of usersData) {
    const existing = await query('SELECT id FROM users WHERE email = $1', [u.email]);
    if (existing.rows.length === 0) {
      const res = await query(
        `INSERT INTO users (hospital_id, department_id, name, email, password_hash, role, phone, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [hospitalId, u.dept, u.name, u.email, passwordHash, u.role, u.phone, true]
      );
      userMap[u.email] = res.rows[0]?.id || Object.keys(userMap).length + 1;
    } else {
      userMap[u.email] = existing.rows[0].id;
    }
  }

  // 5. Seed Accreditation Requirements (NABH / JCI)
  const requirementsData = [
    {
      standard: 'NABH 5th Edition',
      chapter: 'Patient Safety and Quality (PSQ)',
      code: 'PSQ.1',
      title: 'Multidisciplinary Patient Safety Program & Sentinel Event Reporting',
      dept: deptMap['QPS'],
      status: 'Compliant',
      priority: 'Critical',
      due: '2026-09-15',
      score: 100
    },
    {
      standard: 'NABH 5th Edition',
      chapter: 'Care of Patients (COP)',
      code: 'COP.3',
      title: 'Emergency Resuscitation Services & Code Blue Protocol Compliance',
      dept: deptMap['ECC'],
      status: 'Partially Compliant',
      priority: 'High',
      due: '2026-09-30',
      score: 65
    },
    {
      standard: 'NABH 5th Edition',
      chapter: 'Hospital Infection Control (HIC)',
      code: 'HIC.2',
      title: 'Hand Hygiene Adherence Monitoring & Surveillance of Healthcare-Associated Infections (HAI)',
      dept: deptMap['HIC'],
      status: 'Compliant',
      priority: 'Critical',
      due: '2026-09-20',
      score: 95
    },
    {
      standard: 'NABH 5th Edition',
      chapter: 'Management of Medication (MOM)',
      code: 'MOM.4',
      title: 'Storage and Safe Dispensing of High-Alert and Look-Alike Sound-Alike (LASA) Medications',
      dept: deptMap['PHARM'],
      status: 'Non-Compliant',
      priority: 'Critical',
      due: '2026-08-30', // Overdue for alert testing!
      score: 30
    },
    {
      standard: 'NABH 5th Edition',
      chapter: 'Facility Management and Safety (FMS)',
      code: 'FMS.1',
      title: 'Statutory Fire Safety NOC, Evacuation Drills & Medical Gas Pipeline Testing',
      dept: deptMap['FMS'],
      status: 'Under Review',
      priority: 'High',
      due: '2026-10-10',
      score: 75
    },
    {
      standard: 'JCI 7th Edition',
      chapter: 'International Patient Safety Goals (IPSG)',
      code: 'IPSG.1',
      title: 'Identify Patients Correctly Using Two Unique Identifiers Prior to Any Procedure/Medication',
      dept: deptMap['NURS'],
      status: 'Compliant',
      priority: 'Critical',
      due: '2026-09-10',
      score: 100
    },
    {
      standard: 'JCI 7th Edition',
      chapter: 'IPSG',
      code: 'IPSG.2',
      title: 'Improve Effective Communication - Read-Back of Critical Lab Values and Verbal Orders',
      dept: deptMap['ECC'],
      status: 'Partially Compliant',
      priority: 'High',
      due: '2026-09-25',
      score: 60
    },
    {
      standard: 'NABH 5th Edition',
      chapter: 'Human Resource Management (HRM)',
      code: 'HRM.3',
      title: 'Credentialing and Privileging of Clinical Staff & Annual Competency Evaluations',
      dept: deptMap['QPS'],
      status: 'Pending',
      priority: 'Medium',
      due: '2026-11-01',
      score: 0
    }
  ];

  const reqMap = {};
  for (const r of requirementsData) {
    const existing = await query('SELECT id FROM requirements WHERE hospital_id = $1 AND code = $2', [hospitalId, r.code]);
    if (existing.rows.length === 0) {
      const res = await query(
        `INSERT INTO requirements (hospital_id, department_id, standard, chapter, code, title, description, status, priority, due_date, assigned_to, compliance_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          hospitalId,
          r.dept,
          r.standard,
          r.chapter,
          r.code,
          r.title,
          `Mandatory compliance standard according to ${r.standard} guidelines for ${r.chapter}.`,
          r.status,
          r.priority,
          r.due,
          userMap['admin@medicare.org'],
          r.score
        ]
      );
      reqMap[r.code] = res.rows[0]?.id || Object.keys(reqMap).length + 1;
    } else {
      reqMap[r.code] = existing.rows[0].id;
    }
  }

  // 6. Seed Department KPIs
  const kpisData = [
    {
      name: 'Hand Hygiene Compliance Rate',
      code: 'KPI-HIC-01',
      category: 'Infection Control',
      dept: deptMap['HIC'],
      target: 90.0,
      actual: 92.5,
      unit: '%',
      frequency: 'Monthly',
      status: 'Green',
      formula: '(Compliant Hand Hygiene Moments / Total Observed Moments) * 100'
    },
    {
      name: 'Catheter-Associated UTI (CAUTI) Rate',
      code: 'KPI-HIC-02',
      category: 'Infection Control',
      dept: deptMap['HIC'],
      target: 1.5,
      actual: 1.1,
      unit: 'per 1000 days',
      frequency: 'Monthly',
      status: 'Green',
      formula: '(CAUTI Cases / Total Urinary Catheter Days) * 1000'
    },
    {
      name: 'Code Blue Resuscitation Response Time',
      code: 'KPI-ECC-01',
      category: 'Emergency Care',
      dept: deptMap['ECC'],
      target: 3.0,
      actual: 3.8, // Slightly higher than target -> Yellow
      unit: 'minutes',
      frequency: 'Monthly',
      status: 'Yellow',
      formula: 'Average elapsed time from Code Blue call to team arrival'
    },
    {
      name: 'Medication Administration Error Rate',
      code: 'KPI-PHARM-01',
      category: 'Patient Safety',
      dept: deptMap['PHARM'],
      target: 0.5,
      actual: 2.3, // Significantly higher than target -> Red
      unit: 'per 1000 doses',
      frequency: 'Monthly',
      status: 'Red',
      formula: '(Reported Medication Errors / Total Doses Administered) * 1000'
    },
    {
      name: 'High-Alert Drug Double-Check Compliance',
      code: 'KPI-NURS-01',
      category: 'Nursing Safety',
      dept: deptMap['NURS'],
      target: 98.0,
      actual: 88.0, // Below target -> Yellow
      unit: '%',
      frequency: 'Monthly',
      status: 'Yellow',
      formula: '(Documented Dual Sign-offs / High Alert Administrations) * 100'
    },
    {
      name: 'Discharge Summary Turnaround Time < 24 Hours',
      code: 'KPI-QPS-01',
      category: 'Clinical Quality',
      dept: deptMap['QPS'],
      target: 95.0,
      actual: 96.2,
      unit: '%',
      frequency: 'Monthly',
      status: 'Green',
      formula: '(Summaries completed < 24h / Total Discharges) * 100'
    },
    {
      name: 'Statutory Fire NOC & Equipment Certification',
      code: 'KPI-FMS-01',
      category: 'Facility Safety',
      dept: deptMap['FMS'],
      target: 100.0,
      actual: 85.0,
      unit: '%',
      frequency: 'Quarterly',
      status: 'Yellow',
      formula: '(Current Certifications / Total Required Equipment) * 100'
    }
  ];

  for (const k of kpisData) {
    const existing = await query('SELECT id FROM kpis WHERE hospital_id = $1 AND code = $2', [hospitalId, k.code]);
    if (existing.rows.length === 0) {
      await query(
        `INSERT INTO kpis (hospital_id, department_id, name, code, category, target_value, actual_value, unit, frequency, status, calculation_formula, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          hospitalId,
          k.dept,
          k.name,
          k.code,
          k.category,
          k.target,
          k.actual,
          k.unit,
          k.frequency,
          k.status,
          k.formula,
          userMap['admin@medicare.org']
        ]
      );
    }
  }

  // 7. Seed Audits
  const auditsData = [
    {
      title: 'Q3 Comprehensive NABH Internal Mock Audit',
      type: 'Internal Mock Audit',
      dept: deptMap['QPS'],
      leadAuditor: userMap['auditor@medicare.org'],
      scheduled: '2026-08-10',
      completed: '2026-08-12',
      status: 'Completed',
      summary: 'Comprehensive mock audit across clinical and operational areas. General compliance is strong, with critical corrective action needed in Pharmacy LASA labeling and Emergency crash cart checklist frequency.',
      score: 84.5
    },
    {
      title: 'JCI Accreditation Readiness Surveillance Audit',
      type: 'Accreditation Surveillance',
      dept: deptMap['ECC'],
      leadAuditor: userMap['auditor@medicare.org'],
      scheduled: '2026-08-20',
      completed: null,
      status: 'In Progress',
      summary: 'Evaluating emergency resuscitation workflows, critical lab reporting read-backs, and patient identification compliance.',
      score: 72.0
    },
    {
      title: 'Annual Facility Safety & Biomedical Engineering Audit',
      type: 'Statutory Safety Audit',
      dept: deptMap['FMS'],
      leadAuditor: userMap['auditor@medicare.org'],
      scheduled: '2026-09-18',
      completed: null,
      status: 'Scheduled',
      summary: 'Scheduled inspection for medical gas distribution system, generator testing logs, and hazardous spill containment kits.',
      score: 0.0
    }
  ];

  const auditMap = {};
  for (const a of auditsData) {
    const existing = await query('SELECT id FROM audits WHERE hospital_id = $1 AND title = $2', [hospitalId, a.title]);
    if (existing.rows.length === 0) {
      const res = await query(
        `INSERT INTO audits (hospital_id, department_id, title, audit_type, lead_auditor_id, scheduled_date, completed_date, status, summary, score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [hospitalId, a.dept, a.title, a.type, a.leadAuditor, a.scheduled, a.completed, a.status, a.summary, a.score]
      );
      auditMap[a.title] = res.rows[0]?.id || Object.keys(auditMap).length + 1;
    } else {
      auditMap[a.title] = existing.rows[0].id;
    }
  }

  // 8. Seed Audit Findings
  const completedAuditId = auditMap['Q3 Comprehensive NABH Internal Mock Audit'] || 1;
  const inProgressAuditId = auditMap['JCI Accreditation Readiness Surveillance Audit'] || 2;

  const findingsData = [
    {
      auditId: completedAuditId,
      reqId: reqMap['MOM.4'],
      title: 'Absence of Tall-Man Lettering and Color-Coded Separation for LASA Medications in Satellite Pharmacy',
      desc: 'During pharmacy spot check, Epinephrine 1:1000 and Ephedrine ampoules were stored adjacent in the emergency drawer without fluorescent high-alert auxiliary warning labels or tall-man lettering separation.',
      severity: 'Critical',
      category: 'Medication Safety',
      suggestedAction: 'Immediately quarantine adjoining bins, affix standardized neon warning tags, and configure digital barcode scanning verification prior to dispensing.',
      status: 'Linked to CAPA'
    },
    {
      auditId: completedAuditId,
      reqId: reqMap['COP.3'],
      title: 'Crash Cart Defibrillator Battery Daily Check Log Missing for 4 Consecutive Days',
      desc: 'In Emergency Bay 2, the daily defibrillator self-test and paddle verification log was incomplete for the past weekend.',
      severity: 'Major',
      category: 'Emergency Equipment',
      suggestedAction: 'Implement biometric or digitized QR-code sign-off on crash cart inspection each nursing shift.',
      status: 'Linked to CAPA'
    },
    {
      auditId: inProgressAuditId,
      reqId: reqMap['IPSG.2'],
      title: 'Critical Lab Value Verbal Read-Back Not Documented in 3 Patient Charts',
      desc: 'Review of ICU telemetry charts showed critical serum Potassium (<2.5 mEq/L) reported verbally without explicit timestamped "Read-Back Verified" nurse initials.',
      severity: 'Major',
      category: 'Clinical Communication',
      suggestedAction: 'Mandate automated HIS prompt for critical value verbal orders requiring two-party digital confirmation.',
      status: 'Open'
    },
    {
      auditId: completedAuditId,
      reqId: reqMap['HIC.2'],
      title: 'Alcohol-Based Hand Rub Dispenser Depleted Near Bed 14 in Stepdown Unit',
      desc: 'Dispenser at bedside was found empty during morning rounds; replacement was not requested via facilities portal.',
      severity: 'Minor',
      category: 'Infection Control',
      suggestedAction: 'Refill dispenser and reinforce shift checklist responsibility with unit charge nurse.',
      status: 'Resolved'
    }
  ];

  const findingMap = {};
  for (const f of findingsData) {
    const existing = await query('SELECT id FROM audit_findings WHERE audit_id = $1 AND title = $2', [f.auditId, f.title]);
    if (existing.rows.length === 0) {
      const res = await query(
        `INSERT INTO audit_findings (audit_id, requirement_id, title, description, severity, category, suggested_action, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [f.auditId, f.reqId, f.title, f.desc, f.severity, f.category, f.suggestedAction, f.status]
      );
      findingMap[f.title] = res.rows[0]?.id || Object.keys(findingMap).length + 1;
    } else {
      findingMap[f.title] = existing.rows[0].id;
    }
  }

  // 9. Seed Corrective Actions (CAPA)
  const lasaFindingId = findingMap['Absence of Tall-Man Lettering and Color-Coded Separation for LASA Medications in Satellite Pharmacy'] || 1;
  const crashCartFindingId = findingMap['Crash Cart Defibrillator Battery Daily Check Log Missing for 4 Consecutive Days'] || 2;

  const capaData = [
    {
      findingId: lasaFindingId,
      reqId: reqMap['MOM.4'],
      dept: deptMap['PHARM'],
      title: 'Implement Tall-Man Lettering & High-Alert Storage Protocol in All Satellite Pharmacies',
      desc: 'Comprehensive overhaul of satellite medication drawers to eliminate look-alike sound-alike drug mix-ups.',
      rootCause: 'Lack of visual distinction guidelines and lack of physical shelf dividers in newly commissioned satellite pharmacy unit.',
      actionPlan: '1. Audit all 48 LASA pairs across formulary.\n2. Apply neon orange high-alert sleeves.\n3. Implement dual-pharmacist verification workflow.',
      assignedTo: userMap['depthead@medicare.org'],
      due: '2026-08-28', // Overdue for alert testing!
      status: 'In Progress',
      completionDate: null,
      verifiedBy: null,
      verificationNotes: null
    },
    {
      findingId: crashCartFindingId,
      reqId: reqMap['COP.3'],
      title: 'Digital QR-Code Verification System for Emergency Crash Carts',
      desc: 'Replace paper-based binders with digital tablet shift checklists.',
      rootCause: 'Shift turnover handover distraction leading to paper logs being forgotten during emergency admissions.',
      actionPlan: 'Deploy tamper-evident numbered seals with daily morning QR scan checklist integrated into nurse roster.',
      assignedTo: userMap['staff@medicare.org'],
      due: '2026-09-10',
      status: 'Completed',
      completionDate: '2026-08-21',
      verifiedBy: userMap['auditor@medicare.org'],
      verificationNotes: 'Random inspection of 6 emergency crash carts demonstrated 100% digital check compliance for 7 consecutive days.'
    }
  ];

  const capaMap = {};
  for (const c of capaData) {
    const existing = await query('SELECT id FROM corrective_actions WHERE hospital_id = $1 AND title = $2', [hospitalId, c.title]);
    if (existing.rows.length === 0) {
      const res = await query(
        `INSERT INTO corrective_actions (hospital_id, department_id, finding_id, requirement_id, title, description, root_cause, action_plan, assigned_to, due_date, status, completion_date, verified_by, verification_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
        [
          hospitalId,
          c.dept,
          c.findingId,
          c.reqId,
          c.title,
          c.desc,
          c.rootCause,
          c.actionPlan,
          c.assignedTo,
          c.due,
          c.status,
          c.completionDate,
          c.verifiedBy,
          c.verificationNotes
        ]
      );
      capaMap[c.title] = res.rows[0]?.id || Object.keys(capaMap).length + 1;
    } else {
      capaMap[c.title] = existing.rows[0].id;
    }
  }

  // 10. Seed Documents as real BYTEA binary in Postgres
  const samplePdfContent = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Contents 4 0 R>>endobj 4 0 obj<</Length 85>>stream\nBT /F1 16 Tf 50 700 Td (Hospital Accreditation Evidence Document - Metro Apex) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000214 00000 n\ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n349\n%%EOF',
    'utf-8'
  );

  const sampleDocFiles = [
    {
      filename: 'NABH_PSQ1_Patient_Safety_Charter_2026.pdf',
      mime: 'application/pdf',
      dept: deptMap['QPS'],
      reqId: reqMap['PSQ.1'],
      auditId: completedAuditId,
      capaId: null,
      docType: 'Policy Document',
      expiry: '2027-08-01',
      tags: 'NABH, Patient Safety, Sentinel Event, Policy'
    },
    {
      filename: 'HIC_Hand_Hygiene_Surveillance_Audit_Report.pdf',
      mime: 'application/pdf',
      dept: deptMap['HIC'],
      reqId: reqMap['HIC.2'],
      auditId: completedAuditId,
      capaId: null,
      docType: 'Audit Evidence',
      expiry: '2026-09-05', // Expiring soon for alert check!
      tags: 'Infection Control, Hand Hygiene, WHO Moments'
    },
    {
      filename: 'LASA_Medications_Master_Protocol_v3.pdf',
      mime: 'application/pdf',
      dept: deptMap['PHARM'],
      reqId: reqMap['MOM.4'],
      auditId: completedAuditId,
      capaId: capaMap['Implement Tall-Man Lettering & High-Alert Storage Protocol in All Satellite Pharmacies'],
      docType: 'SOP & Corrective Action Proof',
      expiry: '2026-12-31',
      tags: 'LASA, High Alert, Pharmacy, CAPA Evidence'
    }
  ];

  for (const doc of sampleDocFiles) {
    const existing = await query('SELECT id FROM documents WHERE hospital_id = $1 AND filename = $2', [hospitalId, doc.filename]);
    if (existing.rows.length === 0) {
      await query(
        `INSERT INTO documents (hospital_id, department_id, filename, mime_type, file_size, file_data, uploaded_by, linked_requirement_id, linked_audit_id, linked_corrective_action_id, doc_type, expiry_date, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          hospitalId,
          doc.dept,
          doc.filename,
          doc.mime,
          samplePdfContent.length,
          samplePdfContent,
          userMap['admin@medicare.org'],
          doc.reqId,
          doc.auditId,
          doc.capaId,
          doc.docType,
          doc.expiry,
          doc.tags
        ]
      );
    }
  }

  // 11. Seed Notifications / Alerts
  const notificationsData = [
    {
      userId: userMap['admin@medicare.org'],
      type: 'Alert',
      title: 'Overdue Requirement: MOM.4 High-Alert Medications',
      message: 'Standard MOM.4 requires immediate documentation update. Due date 2026-08-30 is pending.',
      linkUrl: '/requirements'
    },
    {
      userId: userMap['depthead@medicare.org'],
      type: 'Warning',
      title: 'CAPA Action Due Soon: Tall-Man Lettering Protocol',
      message: 'Corrective action for satellite pharmacy LASA segregation is due in 3 days.',
      linkUrl: '/corrective-actions'
    },
    {
      userId: userMap['admin@medicare.org'],
      type: 'Alert',
      title: 'Document Expiring Soon: HIC Hand Hygiene Report',
      message: 'Evidence document HIC_Hand_Hygiene_Surveillance_Audit_Report.pdf expires on 2026-09-05.',
      linkUrl: '/documents'
    },
    {
      userId: userMap['auditor@medicare.org'],
      type: 'Info',
      title: 'Audit In Progress: JCI Accreditation Surveillance',
      message: 'Audit is currently active. 3 findings recorded.',
      linkUrl: '/audits'
    }
  ];

  for (const n of notificationsData) {
    const existing = await query('SELECT id FROM notifications WHERE user_id = $1 AND title = $2', [n.userId, n.title]);
    if (existing.rows.length === 0) {
      await query(
        `INSERT INTO notifications (hospital_id, user_id, type, title, message, is_read, link_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [hospitalId, n.userId, n.type, n.title, n.message, false, n.linkUrl]
      );
    }
  }

  console.log('✅ Seed completed successfully with full hospital accreditation dataset.');
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed error:', err);
      process.exit(1);
    });
}
