import * as fs from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { NoticeAgreement } from '../entities/notice-agreement.entity';
import { Users } from 'src/users/entities/user.entity';
import { JSDOM } from 'jsdom';
import pdf from 'html-pdf';

export const generatePdfBufferFromEditor = (
  htmlContent: string,
): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const cssStyles = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap');

        body {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 16px;
          color: #1f2937;
          line-height: 1.75;
          padding: 1.25rem;
        }

        h1 {
          font-size: 1.5rem;
          font-weight: 700;
          margin-bottom: 1rem;
        }

        h2 {
          font-size: 1.25rem;
          font-weight: 600;
          margin-top: 1rem;
          margin-bottom: 0.75rem;
        }

        p {
          margin-bottom: 0.75rem;
        }

        ul {
          padding-left: 1.5rem;
          list-style-type: disc;
        }

        li {
          margin-bottom: 0.5rem;
        }

        strong {
          font-weight: 600;
        }

        em {
          font-style: italic;
        }

        a {
          color: #3b82f6;
          text-decoration: underline;
        }

        hr {
          margin: 2rem 0;
          border: none;
          border-top: 1px solid #d1d5db;
        }
      </style>
    `;

    const completeHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          ${cssStyles}
        </head>
        <body>
          <div class="ql-editor">
            ${htmlContent}
          </div>
        </body>
      </html>
    `;

    const options: pdf.CreateOptions = {
      format: 'A4' as const,
      border: '1in',
    };

    pdf.create(completeHtml, options).toBuffer((err, buffer) => {
      if (err) return reject(err);
      resolve(buffer);
    });
  });
};

// export const generatePdfBufferFromEditor = async (
//   htmlContent: string
// ): Promise<Buffer> => {
//   return new Promise((resolve, reject) => {
//     const doc = new PDFDocument({ margin: 50 });
//     const buffers: Buffer[] = [];

//     doc.on('data', buffers.push.bind(buffers));
//     doc.on('end', () => {
//       const pdfBuffer = Buffer.concat(buffers);
//       resolve(pdfBuffer);
//     });

//     // Use JSDOM to parse the HTML and render into PDF
//     const dom = new JSDOM(htmlContent);
//     const paragraphs = dom.window.document.body.querySelectorAll('p');

//     doc.fontSize(14).text('Notice Agreement', { align: 'center' }).moveDown();

//     paragraphs.forEach(p => {
//       doc.fontSize(12).text(p.textContent || '', {
//         paragraphGap: 10,
//       });
//     });

//     doc.end();
//   });
// };

export const generatePdfBufferFromHtml = async (
  html: string,
): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers: Buffer[] = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));

    // Parse HTML using jsdom
    const dom = new JSDOM(html);
    const elements = dom.window.document.body.children;

    Array.from(elements).forEach((el: Element) => {
      if (el.tagName === 'H1') {
        doc
          .fontSize(20)
          .text(el.textContent || '', { underline: true })
          .moveDown();
      } else if (el.tagName === 'P') {
        doc
          .fontSize(12)
          .text(el.textContent || '')
          .moveDown();
      } else if (el.tagName === 'STRONG') {
        doc
          .font('Helvetica-Bold')
          .text(el.textContent || '')
          .moveDown();
      } else {
        doc.text(el.textContent || '').moveDown();
      }
    });

    doc.end();
  });
};

export const generatePdfFromTemplate = async (
  agreement: NoticeAgreement,
  tenant: Users,
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

export const generatePdfBufferFromTemplate = async (
  agreement: any,
  tenant: Users,
): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers: Buffer[] = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(buffers);
      resolve(pdfBuffer);
    });

    // Header
    doc
      .fontSize(20)
      .text(`${agreement.notice_type.toUpperCase()}`, { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(12).text('27th January 2025', { align: 'left' });
    doc.moveDown(1.5);

    // Address Block
    doc
      .font('Helvetica-Bold')
      .text(`Ms. ${tenant.first_name} ${tenant.last_name}`);
    doc.font('Helvetica').text(`${agreement.property_name}`);
    doc.text(`${agreement.property_location}`);
    //   doc.text('Lekki Phase 1, Lagos State.');
    doc.moveDown();

    // Salutation
    doc.text(`Dear ${tenant.last_name},`);
    doc.moveDown();

    // Body Title
    doc.font('Helvetica-Bold').text(`${agreement.notice_type.toUpperCase()}`);
    doc.moveDown(0.5);

    // Body Paragraph
    doc
      .font('Helvetica')
      .fontSize(11)
      .text(
        `This is to formally notify you that your tenancy over the one-bedroom apartment situated at ${agreement.property_location} which you currently occupy expires on the 31st of January 2025. Following the expiry of your tenancy, we hereby make you an offer to rent the apartment for another period upon the following terms:`,
        { lineGap: 4 },
      );
    doc.moveDown();

    // Bullet Points
    doc
      .font('Helvetica-Bold')
      .text('• Permitted Use:', { continued: true })
      .font('Helvetica')
      .text(
        ' Apartment is not permitted for any other use apart from residential use by the Tenant. Any other use, commercial or otherwise is strictly prohibited.',
      );

    doc
      .font('Helvetica-Bold')
      .text('• Rent:', { continued: true })
      .font('Helvetica')
      .text(' ₦2,800,000');
    doc
      .font('Helvetica-Bold')
      .text('• Service Charge:', { continued: true })
      .font('Helvetica')
      .text(' ₦700,000');
    doc
      .font('Helvetica-Bold')
      .text('• Tenancy Term:', { continued: true })
      .font('Helvetica')
      .text(' One Year Fixed');
    doc
      .font('Helvetica-Bold')
      .text('• Tenancy Expiry Date:', { continued: true })
      .font('Helvetica')
      .text(
        ' Commencing on the 1st of February 2025 and Expiring on the 31st of January 2026.',
      );
    doc.moveDown();

    // Payment instructions
    doc
      .font('Helvetica')
      .fontSize(11)
      .text(
        `Please make ALL payments on or before the due date of 31st of January 2025 into the company's account provided below:`,
        { lineGap: 4 },
      );
    doc.moveDown();

    // Account info
    doc
      .font('Helvetica-Bold')
      .text('Account No:', { continued: true })
      .font('Helvetica')
      .text(' 5401475004');
    doc
      .font('Helvetica-Bold')
      .text('Account Bank:', { continued: true })
      .font('Helvetica')
      .text(' Providus Bank');
    doc
      .font('Helvetica-Bold')
      .text('Account Name:', { continued: true })
      .font('Helvetica')
      .text(' Panda Homes Nigeria Limited');
    doc.moveDown(2);

    // Signature
    doc.text('Yours faithfully,');
    doc.moveDown();
    doc.font('Helvetica-Bold').text('Olatunji Oginni');
    doc.font('Helvetica').text('Founder/CEO');
    doc.moveDown(3);

    // Footer line
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(1);

    // Footer content
    doc
      .fontSize(10)
      .text('17 Ayinde Akinmade Street Lekki Phase 1, Lagos State', {
        align: 'center',
      });
    doc.fillColor('blue').text('www.getpanda.ng', {
      align: 'center',
      link: 'https://www.getpanda.ng',
    });

    doc.end();
  });
};
