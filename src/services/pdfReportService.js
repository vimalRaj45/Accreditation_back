import PDFDocument from 'pdfkit';

/**
 * PDF Report Generator for Hospital Accreditation & Compliance
 */
export async function generateCompliancePdfReport({ hospital, readinessData, requirements = [], kpis = [], audits = [], capas = [], aiSummary }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      const readinessScore = Math.round(readinessData?.overallReadinessScore || 0);
      const grade = readinessData?.readinessGrade || 'N/A';
      const weights = readinessData?.weights || { compliance: 0.4, kpi: 0.25, audit: 0.2, evidence: 0.15 };

      let gradeColor = '#059669'; // Green
      if (readinessScore < 50) gradeColor = '#dc2626'; // Red
      else if (readinessScore < 70) gradeColor = '#d97706'; // Amber
      else if (readinessScore < 85) gradeColor = '#0284c7'; // Blue

      // 1. Top Header Banner
      doc.rect(40, 40, 515, 65).fill('#0f172a');
      doc.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold')
        .text(hospital.name || 'Metro Apex Super Specialty Hospital', 55, 52, { width: 485 });
      
      doc.fillColor('#94a3b8').fontSize(9).font('Helvetica')
        .text(`Accreditation Target: ${hospital.accreditation_target || 'NABH 5th & JCI 7th Edition'}   |   Report Date: ${new Date().toLocaleDateString()}`, 55, 78, { width: 485 });

      let curY = 120;

      // 2. Executive Readiness Summary Card
      doc.rect(40, curY, 515, 75).fillAndStroke('#f8fafc', '#e2e8f0');

      doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold')
        .text('1. Executive Compliance & Readiness Index', 55, curY + 12);

      // Score + Status Line
      const scoreLineY = curY + 30;
      doc.fontSize(10).font('Helvetica').fillColor('#334155')
        .text('Overall Readiness Score:', 55, scoreLineY);
      
      doc.fontSize(14).font('Helvetica-Bold').fillColor(gradeColor)
        .text(`${readinessScore}%`, 185, scoreLineY - 2);

      doc.fontSize(10).font('Helvetica').fillColor('#334155')
        .text('Accreditation Status:', 240, scoreLineY);

      doc.fontSize(10).font('Helvetica-Bold').fillColor(gradeColor)
        .text(grade, 345, scoreLineY);

      // Scoring Weights Line
      const weightLineY = curY + 52;
      doc.fontSize(8.5).font('Helvetica').fillColor('#64748b')
        .text(`Configured Weights: Standards (${(weights.compliance * 100).toFixed(0)}%) | KPIs (${(weights.kpi * 100).toFixed(0)}%) | Audits (${(weights.audit * 100).toFixed(0)}%) | Evidence Documents (${(weights.evidence * 100).toFixed(0)}%)`, 55, weightLineY);

      curY += 90;

      // 3. Section 2: AI Clinical Quality & Risk Assessment
      doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold')
        .text('2. AI Clinical Quality & Risk Assessment', 40, curY);

      curY += 18;

      const summaryText = aiSummary?.summaryParagraph ||
        `Hospital accreditation readiness is currently indexed at ${readinessScore}%. Key areas requiring priority focus include high-alert medication protocols and prompt closure of overdue corrective action plans (CAPA).`;

      doc.rect(40, curY, 515, 95).fillAndStroke('#f1f5f9', '#cbd5e1');

      doc.fillColor('#1e293b').fontSize(9).font('Helvetica')
        .text(summaryText, 55, curY + 10, { width: 485, align: 'justify', lineGap: 3 });

      curY += 110;

      // 4. Section 3: Departmental Compliance Scorecard
      doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold')
        .text('3. Departmental Compliance Scorecard', 40, curY);

      curY += 18;

      // Table Header
      doc.rect(40, curY, 515, 20).fill('#0f172a');
      doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica-Bold')
        .text('Department Name', 50, curY + 5)
        .text('Code', 220, curY + 5)
        .text('Reqs', 280, curY + 5)
        .text('Standards %', 340, curY + 5)
        .text('KPI %', 415, curY + 5)
        .text('Readiness', 475, curY + 5);

      curY += 20;

      const departments = readinessData?.departmentBreakdown || [];
      departments.forEach((dept, idx) => {
        if (curY > 720) {
          doc.addPage();
          curY = 50;
        }

        const isEven = idx % 2 === 0;
        doc.rect(40, curY, 515, 18).fill(isEven ? '#ffffff' : '#f8fafc');

        doc.fillColor('#334155').fontSize(8.5).font('Helvetica')
          .text(dept.name || 'Department', 50, curY + 4, { width: 160, ellipsis: true })
          .text(dept.code || '-', 220, curY + 4)
          .text(String(dept.requirementsCount || 0), 280, curY + 4)
          .text(`${dept.complianceScore || 0}%`, 340, curY + 4)
          .text(`${dept.kpiScore || 0}%`, 415, curY + 4);

        const dScore = Math.round(dept.readinessScore || 0);
        const dColor = dScore >= 80 ? '#059669' : dScore >= 60 ? '#d97706' : '#dc2626';

        doc.fillColor(dColor).font('Helvetica-Bold')
          .text(`${dScore}%`, 475, curY + 4);

        curY += 18;
      });

      curY += 15;

      // 5. Section 4: Corrective Actions (CAPA)
      if (curY > 640) {
        doc.addPage();
        curY = 50;
      }

      doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold')
        .text('4. High Priority Corrective Actions (CAPA)', 40, curY);

      curY += 18;

      if (!capas || capas.length === 0) {
        doc.fillColor('#64748b').fontSize(9).font('Helvetica')
          .text('No active corrective actions pending.', 40, curY);
      } else {
        capas.slice(0, 4).forEach((c, idx) => {
          if (curY > 720) {
            doc.addPage();
            curY = 50;
          }

          doc.rect(40, curY, 515, 34).fillAndStroke('#ffffff', '#e2e8f0');

          doc.fillColor('#0f172a').fontSize(8.5).font('Helvetica-Bold')
            .text(`${idx + 1}. ${c.title || 'CAPA Item'}`, 48, curY + 6, { width: 340, ellipsis: true });

          doc.fillColor(c.status === 'Completed' || c.status === 'Verified' ? '#059669' : '#d97706').fontSize(8).font('Helvetica-Bold')
            .text(`Status: ${c.status || 'Open'}`, 410, curY + 6);

          doc.fillColor('#64748b').fontSize(7.5).font('Helvetica')
            .text(`Department: ${c.dept_name || 'General'}   |   Due Date: ${c.due_date || 'N/A'}   |   Assignee: ${c.assignee_name || 'Quality Lead'}`, 48, curY + 20, { width: 490 });

          curY += 40;
        });
      }

      // Footer on all pages
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(7.5).font('Helvetica').fillColor('#94a3b8')
          .text('AccreditPro Quality Management Engine   |   Confidential - Hospital Internal Review Only', 40, 790, { width: 380 })
          .text(`Page ${i + 1} of ${range.count}`, 450, 790, { width: 105, align: 'right' });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * CSV Exporters
 */
export function generateCsvExport(data = [], type = 'requirements') {
  if (!data || data.length === 0) return 'No data available';

  let headers = [];
  let rows = [];

  if (type === 'requirements') {
    headers = ['ID', 'Code', 'Standard', 'Chapter', 'Title', 'Status', 'Priority', 'Due Date', 'Compliance Score'];
    rows = data.map(r => [
      r.id,
      `"${r.code || ''}"`,
      `"${r.standard || ''}"`,
      `"${r.chapter || ''}"`,
      `"${(r.title || '').replace(/"/g, '""')}"`,
      r.status,
      r.priority,
      r.due_date || '',
      r.compliance_score || 0
    ]);
  } else if (type === 'kpis') {
    headers = ['ID', 'Code', 'Name', 'Category', 'Target', 'Actual', 'Unit', 'Frequency', 'Status'];
    rows = data.map(k => [
      k.id,
      `"${k.code || ''}"`,
      `"${(k.name || '').replace(/"/g, '""')}"`,
      `"${k.category || ''}"`,
      k.target_value,
      k.actual_value,
      `"${k.unit || ''}"`,
      `"${k.frequency || ''}"`,
      k.status
    ]);
  } else if (type === 'audits') {
    headers = ['ID', 'Title', 'Type', 'Scheduled Date', 'Status', 'Score', 'Findings Count'];
    rows = data.map(a => [
      a.id,
      `"${(a.title || '').replace(/"/g, '""')}"`,
      `"${a.audit_type || ''}"`,
      a.scheduled_date || '',
      a.status || '',
      a.score || 0,
      a.findings_count || 0
    ]);
  } else if (type === 'capa') {
    headers = ['ID', 'Title', 'Department', 'Assignee', 'Due Date', 'Status'];
    rows = data.map(c => [
      c.id,
      `"${(c.title || '').replace(/"/g, '""')}"`,
      `"${c.department_name || ''}"`,
      `"${c.assignee_name || ''}"`,
      c.due_date || '',
      c.status
    ]);
  }

  const csvLines = [headers.join(',')];
  rows.forEach(row => csvLines.push(row.join(',')));
  return csvLines.join('\n');
}
