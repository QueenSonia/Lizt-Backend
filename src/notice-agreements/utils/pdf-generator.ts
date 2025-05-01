import * as fs from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { NoticeAgreement } from '../entities/notice-agreement.entity';
import { Users } from 'src/users/entities/user.entity';

export const generatePdfFromTemplate = async (
  agreement: NoticeAgreement,
  tenant: Users
): Promise<string> => {
    const outputDir = path.join(process.cwd(), 'src', 'generated-contracts');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

  const pdfFileName = `${Date.now()}-notice.pdf`;
  const pdfPath = path.join(outputDir, pdfFileName);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const stream = fs.createWriteStream(pdfPath);

    doc.pipe(stream);

    // Header: Logo and Title
    // doc.image('assets/logo.png', 50, 45, { width: 50 });
    doc.fontSize(18).text('Notice Agreement', 110, 57);
    doc.moveDown();

    // Agreement Body
    doc.fontSize(12);
    doc.text(`Tenant: ${tenant.first_name}`);
    doc.text(`Property: ${agreement.property_name}`);
    doc.text(`Notice Type: ${agreement.notice_type}`);
    doc.text(`Status: ${agreement.status}`);

    const effectiveDate = new Date(agreement.effective_date);
    doc.text(`Effective Date: ${effectiveDate.toDateString()}`);

    if (agreement.additional_notes) {
      doc.moveDown().text(`Additional Notes: ${agreement.additional_notes}`);
    }

    doc.end();

    stream.on('finish', () => resolve(pdfPath));
    stream.on('error', reject);
  });
};
