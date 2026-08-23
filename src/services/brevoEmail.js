import dotenv from 'dotenv';
dotenv.config();

/**
 * Brevo (formerly Sendinblue) Transactional Email Service
 * Uses native fetch to Brevo v3 SMTP API with automated graceful fallback for testing
 */
export async function sendBrevoEmail({ to, toName, subject, htmlContent, textContent, tags = [] }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'compliance@medicare-health.org';
  const senderName = process.env.BREVO_SENDER_NAME || 'Hospital Accreditation & Compliance Officer';

  const recipientEmail = Array.isArray(to) ? to[0] : to;
  const recipientName = toName || recipientEmail.split('@')[0];

  // If no live API key provided or contains placeholder, log gracefully
  if (!apiKey || apiKey.startsWith('xkeysib-demo') || apiKey === 'your-brevo-api-key') {
    console.log(`[Brevo Email Service] Simulated email dispatched to: ${recipientEmail} | Subject: "${subject}"`);
    return {
      success: true,
      mode: 'simulated',
      messageId: `sim-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      recipient: recipientEmail,
      subject
    };
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: recipientEmail, name: recipientName }],
        subject,
        htmlContent: htmlContent || `<p>${textContent || subject}</p>`,
        textContent: textContent || subject,
        tags
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.warn('[Brevo Email API Warning]:', data);
      return {
        success: false,
        error: data.message || 'Brevo API error',
        code: response.status
      };
    }

    console.log(`[Brevo Email Service] Live email sent! MessageId: ${data.messageId}`);
    return {
      success: true,
      mode: 'live',
      messageId: data.messageId,
      recipient: recipientEmail
    };
  } catch (err) {
    console.error('[Brevo Email Service Error]:', err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

// 1. Trigger Email for Requirement Due Soon / Overdue
export async function sendRequirementDueAlert({ recipientEmail, recipientName, requirementTitle, code, dueDate, isOverdue }) {
  const urgency = isOverdue ? 'CRITICAL: Accreditation Requirement Overdue' : 'URGENT: Accreditation Requirement Due Soon';
  const statusColor = isOverdue ? '#dc2626' : '#ea580c';

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
      <div style="background-color: ${statusColor}; color: #ffffff; padding: 12px 18px; border-radius: 6px; margin-bottom: 20px;">
        <h2 style="margin: 0; font-size: 18px;">${urgency}</h2>
      </div>
      <p style="font-size: 15px; color: #334155;">Hello <strong>${recipientName || 'Compliance Lead'}</strong>,</p>
      <p style="font-size: 14px; color: #475569;">
        This automated notification is issued regarding mandatory accreditation requirement compliance under the NABH / JCI monitoring program.
      </p>
      <div style="background-color: #f8fafc; border-left: 4px solid ${statusColor}; padding: 14px; margin: 20px 0; border-radius: 4px;">
        <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>Standard Code:</strong> <span style="background-color: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-weight: 600;">${code}</span></p>
        <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>Requirement Title:</strong> ${requirementTitle}</p>
        <p style="margin: 0; font-size: 14px;"><strong>Target Due Date:</strong> <span style="color: ${statusColor}; font-weight: bold;">${dueDate}</span></p>
      </div>
      <p style="font-size: 14px; color: #475569;">
        Please upload verified evidence documents or update the compliance status directly in the hospital portal.
      </p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <p style="font-size: 12px; color: #94a3b8; text-align: center;">
        Hospital Accreditation & Compliance Management System &bull; Automated Alert Engine
      </p>
    </div>
  `;

  return sendBrevoEmail({
    to: recipientEmail,
    toName: recipientName,
    subject: `[${code}] ${urgency}: ${requirementTitle}`,
    htmlContent,
    tags: ['requirement-alert', isOverdue ? 'overdue' : 'due-soon']
  });
}

// 2. Trigger Email for Corrective Action (CAPA) Overdue
export async function sendCapaOverdueAlert({ recipientEmail, recipientName, capaTitle, dueDate, findingTitle, departmentName }) {
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
      <div style="background-color: #dc2626; color: #ffffff; padding: 12px 18px; border-radius: 6px; margin-bottom: 20px;">
        <h2 style="margin: 0; font-size: 18px;">ACTION OVERDUE: Corrective & Preventive Action (CAPA)</h2>
      </div>
      <p style="font-size: 15px; color: #334155;">Attention <strong>${recipientName || 'Department Lead'}</strong>,</p>
      <p style="font-size: 14px; color: #475569;">
        The following Corrective and Preventive Action (CAPA) assigned to <strong>${departmentName || 'your department'}</strong> has exceeded its target resolution deadline.
      </p>
      <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 14px; margin: 20px 0; border-radius: 4px;">
        <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>CAPA Action:</strong> ${capaTitle}</p>
        <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>Linked Finding:</strong> ${findingTitle || 'N/A'}</p>
        <p style="margin: 0; font-size: 14px;"><strong>Overdue Date:</strong> <span style="color: #dc2626; font-weight: bold;">${dueDate}</span></p>
      </div>
      <p style="font-size: 14px; color: #475569;">
        Failure to resolve audit non-conformances impacts overall hospital accreditation score and readiness index.
      </p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <p style="font-size: 12px; color: #94a3b8; text-align: center;">
        Hospital Accreditation & Compliance Management System &bull; Brevo Transactional Gateway
      </p>
    </div>
  `;

  return sendBrevoEmail({
    to: recipientEmail,
    toName: recipientName,
    subject: `[CAPA OVERDUE] ${capaTitle}`,
    htmlContent,
    tags: ['capa-alert', 'overdue']
  });
}

// 3. Trigger Email for Document Expiring Soon
export async function sendDocumentExpiringAlert({ recipientEmail, recipientName, filename, expiryDate, docType, departmentName }) {
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
      <div style="background-color: #d97706; color: #ffffff; padding: 12px 18px; border-radius: 6px; margin-bottom: 20px;">
        <h2 style="margin: 0; font-size: 18px;">DOCUMENT EXPIRY WARNING</h2>
      </div>
      <p style="font-size: 15px; color: #334155;">Dear <strong>${recipientName || 'Document Custodian'}</strong>,</p>
      <p style="font-size: 14px; color: #475569;">
        The statutory/evidence document listed below is approaching expiration and requires renewal.
      </p>
      <div style="background-color: #fffbeb; border-left: 4px solid #d97706; padding: 14px; margin: 20px 0; border-radius: 4px;">
        <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>Document:</strong> ${filename}</p>
        <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>Category:</strong> ${docType || 'Evidence'}</p>
        <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>Department:</strong> ${departmentName || 'General Hospital'}</p>
        <p style="margin: 0; font-size: 14px;"><strong>Expiration Date:</strong> <span style="color: #d97706; font-weight: bold;">${expiryDate}</span></p>
      </div>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <p style="font-size: 12px; color: #94a3b8; text-align: center;">
        Hospital Accreditation & Compliance Management System &bull; Document Management Service
      </p>
    </div>
  `;

  return sendBrevoEmail({
    to: recipientEmail,
    toName: recipientName,
    subject: `[DOCUMENT EXPIRY] ${filename} expires on ${expiryDate}`,
    htmlContent,
    tags: ['document-expiry-alert']
  });
}

// 4. Trigger Email for Critical Audit Finding
export async function sendCriticalFindingAlert({ recipientEmail, recipientName, auditTitle, findingTitle, description, suggestedAction }) {
  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
      <div style="background-color: #991b1b; color: #ffffff; padding: 12px 18px; border-radius: 6px; margin-bottom: 20px;">
        <h2 style="margin: 0; font-size: 18px;">CRITICAL AUDIT FINDING IDENTIFIED</h2>
      </div>
      <p style="font-size: 15px; color: #334155;">Urgent Alert for <strong>${recipientName || 'Executive Quality Team'}</strong>,</p>
      <p style="font-size: 14px; color: #475569;">
        A high-severity non-conformance finding has been recorded during audit: <strong>${auditTitle}</strong>.
      </p>
      <div style="background-color: #fef2f2; border-left: 4px solid #991b1b; padding: 14px; margin: 20px 0; border-radius: 4px;">
        <p style="margin: 0 0 6px 0; font-size: 14px; color: #991b1b; font-weight: bold;">Finding: ${findingTitle}</p>
        <p style="margin: 0 0 8px 0; font-size: 13px; color: #475569;">${description}</p>
        <p style="margin: 0; font-size: 13px;"><strong>Recommended Corrective Action:</strong> ${suggestedAction || 'Initiate immediate root-cause analysis and preventive action.'}</p>
      </div>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <p style="font-size: 12px; color: #94a3b8; text-align: center;">
        Hospital Accreditation & Compliance Management System &bull; Quality & Patient Safety Directorate
      </p>
    </div>
  `;

  return sendBrevoEmail({
    to: recipientEmail,
    toName: recipientName,
    subject: `[CRITICAL FINDING] ${findingTitle}`,
    htmlContent,
    tags: ['critical-finding-alert']
  });
}

export default {
  sendBrevoEmail,
  sendRequirementDueAlert,
  sendCapaOverdueAlert,
  sendDocumentExpiringAlert,
  sendCriticalFindingAlert
};
