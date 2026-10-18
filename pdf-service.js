const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function generateClassListPDF(program, classSection, students, outStream) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 36, bottom: 36, left: 36, right: 36 },
    bufferPages: true
  });

  doc.pipe(outStream);

  const primaryColor = '#0A3200';
  const textColor = '#1E293B';
  const mutedText = '#64748B';
  const borderColor = '#CBD5E1';
  const altRowBg = '#F8FAFC';

  const crestPath = path.join(__dirname, 'public', 'ACSES.jpg');
  const sigPath = path.join(__dirname, 'public', 'SIGNATURE.png');

  // --- Header Banner ---
  const bannerY = 36;
  const bannerHeight = 64;
  doc.rect(36, bannerY, 523, bannerHeight).fill(primaryColor);

  // ACSES Crest Logo inside header
  const hasCrest = fs.existsSync(crestPath);
  let textStartX = 46;
  if (hasCrest) {
    try {
      doc.image(crestPath, 46, bannerY + 7, { width: 50, height: 50 });
      textStartX = 106;
    } catch (_) {
      textStartX = 46;
    }
  }

  // Association Title & Program-Specific Official Title
  doc.fillColor('#7CFFCB')
     .fontSize(8)
     .font('Helvetica-Bold')
     .text('ASSOCIATION OF COMPUTER SCIENCE AND ENGINEERING STUDENTS', textStartX, bannerY + 10, { characterSpacing: 0.4 });

  const titleText = `OFFICIAL CLASS LIST OF ${program.toUpperCase()}`;
  const titleSize = titleText.length > 40 ? 11.5 : (titleText.length > 30 ? 12.5 : 13.5);
  doc.fillColor('#FFFFFF')
     .fontSize(titleSize)
     .font('Helvetica-Bold')
     .text(titleText, textStartX, bannerY + 23);

  doc.fillColor('#E2E8F0')
     .fontSize(8.5)
     .font('Helvetica')
     .text('University of Mines and Technology (UMaT) • Office of the Public Relations Officer', textStartX, bannerY + 44);

  // --- Cohort Metadata Box ---
  const metaY = 110;
  doc.rect(36, metaY, 523, 36).fillAndStroke('#F1F5F9', borderColor);

  doc.fillColor(primaryColor)
     .font('Helvetica-Bold')
     .fontSize(10)
     .text(`ACADEMIC PROGRAM: ${program.toUpperCase()}`, 46, metaY + 7);

  doc.fillColor(mutedText)
     .font('Helvetica')
     .fontSize(8.5)
     .text(`Class Cohort: ${classSection.toUpperCase()}   •   Total Enrolled: ${students.length} Students   •   Certified Electoral Roll`, 46, metaY + 21);

  // --- Table Headers (Only #, Reference Number, Student Full Name) ---
  let tableTop = 156;
  const colX = {
    num: 36,
    numText: 46,
    ref: 86,
    refText: 96,
    name: 246,
    nameText: 256
  };

  function drawTableHeader(y) {
    doc.rect(36, y, 523, 22).fill(primaryColor);
    doc.fillColor('#FFFFFF')
       .font('Helvetica-Bold')
       .fontSize(8.5);

    doc.text('#', colX.numText, y + 7);
    doc.text('REFERENCE NUMBER', colX.refText, y + 7);
    doc.text('STUDENT FULL NAME', colX.nameText, y + 7);
  }

  drawTableHeader(tableTop);

  // --- Table Rows ---
  let currentY = tableTop + 22;
  const rowHeight = 20;

  students.forEach((s, idx) => {
    // Pagination check: if near bottom, create a new page and re-draw header
    if (currentY + rowHeight > 740) {
      doc.addPage();
      currentY = 40;
      drawTableHeader(currentY);
      currentY += 22;
    }

    // Zebra striping
    if (idx % 2 === 1) {
      doc.rect(36, currentY, 523, rowHeight).fill(altRowBg);
    }
    // Bottom border
    doc.rect(36, currentY + rowHeight - 0.5, 523, 0.5).fill(borderColor);

    doc.fillColor(textColor)
       .font('Helvetica')
       .fontSize(8.5);

    doc.text((idx + 1).toString(), colX.numText, currentY + 6);
    doc.font('Helvetica-Bold').text(s.reference_number, colX.refText, currentY + 6).font('Helvetica');
    doc.text(s.full_name, colX.nameText, currentY + 6);

    currentY += rowHeight;
  });

  // Check if summary and signature block need a new page
  if (currentY + 160 > 770) {
    doc.addPage();
    currentY = 40;
  }

  // --- Summary Card ---
  const summaryY = currentY + 16;
  doc.rect(36, summaryY, 523, 36).fillAndStroke('#F8FAFC', borderColor);

  doc.fillColor(primaryColor)
     .font('Helvetica-Bold')
     .fontSize(9)
     .text('CLASS COHORT SUMMARY', 46, summaryY + 8);

  doc.fillColor(mutedText)
     .font('Helvetica')
     .fontSize(8)
     .text(`Total Registered Students: ${students.length}   •   Class Cohort: ${classSection.toUpperCase()}   •   Program: ${program.toUpperCase()}`, 46, summaryY + 22);

  // --- Certification & Official Signature Block ---
  const signY = summaryY + 54;

  // Left Side: Certified Official by
  doc.fillColor(primaryColor)
     .font('Helvetica-Bold')
     .fontSize(9.5)
     .text('CERTIFIED BY: ACSES Public Relations Officer', 46, signY);

  doc.fillColor(mutedText)
     .font('Helvetica')
     .fontSize(8.5)
     .text('Association of Computer Science & Engineering Students • UMaT', 46, signY + 14);

  const formattedDate = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  doc.text(`Official Register Verification Date: ${formattedDate}`, 46, signY + 28);

  // Right Side: Signature Image + Christian E. Cudjoe / ACSES PRO
  const sigX = 375;
  const hasSig = fs.existsSync(sigPath);
  let sigTextY = signY + 55;

  if (hasSig) {
    try {
      doc.image(sigPath, sigX, signY - 14, { width: 110 });
      sigTextY = signY + 58;
    } catch (_) {
      sigTextY = signY + 30;
    }
  }

  doc.fillColor(textColor)
     .font('Helvetica-Bold')
     .fontSize(10)
     .text('Christian E. Cudjoe', sigX, sigTextY);

  doc.fillColor(primaryColor)
     .font('Helvetica-Bold')
     .fontSize(8.5)
     .text('ACSES PRO', sigX, sigTextY + 13);

  // --- Page Numbering on all buffered pages ---
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(mutedText)
       .fontSize(7.5)
       .font('Helvetica')
       .text(
         `ACSES Election System • Class List: ${program} (${classSection}) • Page ${i + 1} of ${range.count}`,
         36,
         805,
         { align: 'center', width: 523 }
       );
  }

  doc.end();
}

module.exports = { generateClassListPDF };
