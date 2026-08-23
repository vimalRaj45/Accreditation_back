import cron from 'node-cron';
import { query } from '../config/db.js';
import { sendRequirementDueAlert, sendCapaOverdueAlert, sendDocumentExpiringAlert } from './brevoEmail.js';

/**
 * Automated Alerts & Notification Cron Engine
 * Runs periodic background scans for:
 * 1. Overdue requirements
 * 2. Overdue CAPAs
 * 3. Expiring evidence documents (within 30 days)
 * 4. Underperforming Red KPIs
 */
export async function runAlertsSweep(hospitalId = 1) {
  console.log(`[Alerts Engine] Running automated compliance check sweep for Hospital ID: ${hospitalId}...`);
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  let alertsGenerated = 0;
  let emailsSent = 0;

  // 1. Get Admin & Quality Lead Contacts
  const adminRes = await query(
    `SELECT id, email, name, role FROM users 
     WHERE hospital_id = $1 AND role IN ('Hospital Admin', 'Super Admin') AND is_active = TRUE`,
    [hospitalId]
  );
  const primaryAdmin = adminRes.rows[0] || { id: 1, email: 'admin@medicare.org', name: 'Hospital Admin' };

  // 2. Check Overdue & Due Soon Requirements
  const reqRes = await query(
    `SELECT r.id, r.code, r.title, r.due_date, r.status, r.assigned_to, u.email as assignee_email, u.name as assignee_name
     FROM requirements r
     LEFT JOIN users u ON r.assigned_to = u.id
     WHERE r.hospital_id = $1 AND r.status NOT IN ('Compliant') AND r.due_date IS NOT NULL`,
    [hospitalId]
  );

  for (const req of reqRes.rows) {
    const isOverdue = req.due_date && req.due_date < todayStr;
    const isDueSoon = req.due_date && req.due_date >= todayStr && req.due_date <= thirtyDaysLater;

    if (isOverdue || isDueSoon) {
      const targetUserId = req.assigned_to || primaryAdmin.id;
      const targetEmail = req.assignee_email || primaryAdmin.email;
      const targetName = req.assignee_name || primaryAdmin.name;

      const title = isOverdue ? `Overdue Requirement: [${req.code}] ${req.title}` : `Requirement Due Soon: [${req.code}]`;
      const message = `Standard ${req.code} status is '${req.status}'. Target due date: ${req.due_date}. Immediate action required.`;

      // Check if notification exists today to prevent duplicate spam
      const notifCheck = await query(
        `SELECT id FROM notifications WHERE hospital_id = $1 AND user_id = $2 AND title = $3 AND created_at >= CURRENT_DATE`,
        [hospitalId, targetUserId, title]
      );

      if (notifCheck.rows.length === 0) {
        await query(
          `INSERT INTO notifications (hospital_id, user_id, type, title, message, is_read, link_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [hospitalId, targetUserId, isOverdue ? 'Alert' : 'Warning', title, message, false, '/requirements']
        );
        alertsGenerated++;

        // Send Brevo Email
        if (targetEmail) {
          sendRequirementDueAlert({
            recipientEmail: targetEmail,
            recipientName: targetName,
            requirementTitle: req.title,
            code: req.code,
            dueDate: req.due_date,
            isOverdue
          }).catch(e => console.warn('Brevo alert dispatch error:', e.message));
          emailsSent++;
        }
      }
    }
  }

  // 3. Check Overdue Corrective Actions (CAPA)
  const capaRes = await query(
    `SELECT c.id, c.title, c.due_date, c.status, c.assigned_to, d.name as dept_name, u.email as assignee_email, u.name as assignee_name
     FROM corrective_actions c
     LEFT JOIN departments d ON c.department_id = d.id
     LEFT JOIN users u ON c.assigned_to = u.id
     WHERE c.hospital_id = $1 AND c.status NOT IN ('Completed', 'Verified') AND c.due_date IS NOT NULL`,
    [hospitalId]
  );

  for (const capa of capaRes.rows) {
    if (capa.due_date && capa.due_date < todayStr) {
      const targetUserId = capa.assigned_to || primaryAdmin.id;
      const targetEmail = capa.assignee_email || primaryAdmin.email;
      const targetName = capa.assignee_name || primaryAdmin.name;

      const title = `CAPA Overdue: ${capa.title}`;
      const message = `Corrective action for department ${capa.dept_name || 'Hospital'} was due on ${capa.due_date} and remains '${capa.status}'.`;

      const notifCheck = await query(
        `SELECT id FROM notifications WHERE hospital_id = $1 AND user_id = $2 AND title = $3 AND created_at >= CURRENT_DATE`,
        [hospitalId, targetUserId, title]
      );

      if (notifCheck.rows.length === 0) {
        await query(
          `INSERT INTO notifications (hospital_id, user_id, type, title, message, is_read, link_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [hospitalId, targetUserId, 'Alert', title, message, false, '/corrective-actions']
        );
        alertsGenerated++;

        if (targetEmail) {
          sendCapaOverdueAlert({
            recipientEmail: targetEmail,
            recipientName: targetName,
            capaTitle: capa.title,
            dueDate: capa.due_date,
            departmentName: capa.dept_name
          }).catch(e => console.warn('Brevo CAPA alert dispatch error:', e.message));
          emailsSent++;
        }
      }
    }
  }

  // 4. Check Expiring Documents
  const docsRes = await query(
    `SELECT doc.id, doc.filename, doc.doc_type, doc.expiry_date, doc.uploaded_by, d.name as dept_name, u.email as uploader_email, u.name as uploader_name
     FROM documents doc
     LEFT JOIN departments d ON doc.department_id = d.id
     LEFT JOIN users u ON doc.uploaded_by = u.id
     WHERE doc.hospital_id = $1 AND doc.expiry_date IS NOT NULL AND doc.expiry_date <= $2`,
    [hospitalId, thirtyDaysLater]
  );

  for (const doc of docsRes.rows) {
    const isExpired = doc.expiry_date < todayStr;
    const title = isExpired ? `Document Expired: ${doc.filename}` : `Document Expiring Soon: ${doc.filename}`;
    const message = `Evidence file '${doc.filename}' (${doc.doc_type}) ${isExpired ? 'expired on' : 'expires on'} ${doc.expiry_date}. Please upload renewed certificate.`;

    const targetUserId = doc.uploaded_by || primaryAdmin.id;
    const targetEmail = doc.uploader_email || primaryAdmin.email;
    const targetName = doc.uploader_name || primaryAdmin.name;

    const notifCheck = await query(
      `SELECT id FROM notifications WHERE hospital_id = $1 AND user_id = $2 AND title = $3 AND created_at >= CURRENT_DATE`,
      [hospitalId, targetUserId, title]
    );

    if (notifCheck.rows.length === 0) {
      await query(
        `INSERT INTO notifications (hospital_id, user_id, type, title, message, is_read, link_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [hospitalId, targetUserId, isExpired ? 'Alert' : 'Warning', title, message, false, '/documents']
      );
      alertsGenerated++;

      if (targetEmail) {
        sendDocumentExpiringAlert({
          recipientEmail: targetEmail,
          recipientName: targetName,
          filename: doc.filename,
          expiryDate: doc.expiry_date,
          docType: doc.doc_type,
          departmentName: doc.dept_name
        }).catch(e => console.warn('Brevo doc expiry alert dispatch error:', e.message));
        emailsSent++;
      }
    }
  }

  // 5. Check Red KPIs
  const redKpiRes = await query(
    `SELECT k.name, k.code, k.actual_value, k.target_value, k.unit, d.name as dept_name
     FROM kpis k
     LEFT JOIN departments d ON k.department_id = d.id
     WHERE k.hospital_id = $1 AND k.status = 'Red'`,
    [hospitalId]
  );

  for (const kpi of redKpiRes.rows) {
    const title = `KPI Critical Breach: [${kpi.code}] ${kpi.name}`;
    const message = `Department ${kpi.dept_name || 'Hospital'} reported actual value of ${kpi.actual_value} ${kpi.unit} against target ${kpi.target_value} ${kpi.unit}.`;

    const notifCheck = await query(
      `SELECT id FROM notifications WHERE hospital_id = $1 AND user_id = $2 AND title = $3 AND created_at >= CURRENT_DATE`,
      [hospitalId, primaryAdmin.id, title]
    );

    if (notifCheck.rows.length === 0) {
      await query(
        `INSERT INTO notifications (hospital_id, user_id, type, title, message, is_read, link_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [hospitalId, primaryAdmin.id, 'Alert', title, message, false, '/kpis']
      );
      alertsGenerated++;
    }
  }

  console.log(`[Alerts Engine] Scan completed. In-app alerts: ${alertsGenerated}, Email dispatches: ${emailsSent}`);
  return {
    success: true,
    alertsGenerated,
    emailsSent,
    scannedAt: new Date().toISOString()
  };
}

export function initAlertsCron() {
  // Run every day at 06:00 AM (and on initial boot)
  cron.schedule('0 6 * * *', () => {
    console.log('[Cron Job] Executing scheduled daily compliance alert sweep...');
    runAlertsSweep(1).catch(err => console.error('Daily cron error:', err));
  });

  console.log('⏰ Automated Compliance Alert Cron initialized (Daily 06:00 AM).');
}

export default {
  runAlertsSweep,
  initAlertsCron
};
