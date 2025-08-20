"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePdfBufferFromTemplate = exports.generatePdfFromTemplate = exports.generatePdfBufferFromHtml = exports.generatePdfBufferFromEditor = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const pdfkit_1 = __importDefault(require("pdfkit"));
const jsdom_1 = require("jsdom");
const html_pdf_1 = __importDefault(require("html-pdf"));
const generatePdfBufferFromEditor = (htmlContent) => {
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
        const options = {
            format: 'A4',
            border: '1in',
        };
        html_pdf_1.default.create(completeHtml, options).toBuffer((err, buffer) => {
            if (err)
                return reject(err);
            resolve(buffer);
        });
    });
};
exports.generatePdfBufferFromEditor = generatePdfBufferFromEditor;
const generatePdfBufferFromHtml = async (html) => {
    return new Promise((resolve, reject) => {
        const doc = new pdfkit_1.default({ margin: 50 });
        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        const dom = new jsdom_1.JSDOM(html);
        const elements = dom.window.document.body.children;
        Array.from(elements).forEach((el) => {
            if (el.tagName === 'H1') {
                doc
                    .fontSize(20)
                    .text(el.textContent || '', { underline: true })
                    .moveDown();
            }
            else if (el.tagName === 'P') {
                doc
                    .fontSize(12)
                    .text(el.textContent || '')
                    .moveDown();
            }
            else if (el.tagName === 'STRONG') {
                doc
                    .font('Helvetica-Bold')
                    .text(el.textContent || '')
                    .moveDown();
            }
            else {
                doc.text(el.textContent || '').moveDown();
            }
        });
        doc.end();
    });
};
exports.generatePdfBufferFromHtml = generatePdfBufferFromHtml;
const generatePdfFromTemplate = async (agreement, tenant) => {
    const outputDir = path.join(process.cwd(), 'src', 'generated-contracts');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const pdfFileName = `${Date.now()}-notice.pdf`;
    const pdfPath = path.join(outputDir, pdfFileName);
    return new Promise((resolve, reject) => {
        const doc = new pdfkit_1.default();
        const stream = fs.createWriteStream(pdfPath);
        doc.pipe(stream);
        doc.fontSize(18).text('Notice Agreement', 110, 57);
        doc.moveDown();
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
exports.generatePdfFromTemplate = generatePdfFromTemplate;
const generatePdfBufferFromTemplate = async (agreement, tenant) => {
    return new Promise((resolve, reject) => {
        const doc = new pdfkit_1.default({ margin: 50 });
        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
            const pdfBuffer = Buffer.concat(buffers);
            resolve(pdfBuffer);
        });
        doc
            .fontSize(20)
            .text(`${agreement.notice_type.toUpperCase()}`, { align: 'left' });
        doc.moveDown(0.5);
        doc.fontSize(12).text('27th January 2025', { align: 'left' });
        doc.moveDown(1.5);
        doc
            .font('Helvetica-Bold')
            .text(`Ms. ${tenant.first_name} ${tenant.last_name}`);
        doc.font('Helvetica').text(`${agreement.property_name}`);
        doc.text(`${agreement.property_location}`);
        doc.moveDown();
        doc.text(`Dear ${tenant.last_name},`);
        doc.moveDown();
        doc.font('Helvetica-Bold').text(`${agreement.notice_type.toUpperCase()}`);
        doc.moveDown(0.5);
        doc
            .font('Helvetica')
            .fontSize(11)
            .text(`This is to formally notify you that your tenancy over the one-bedroom apartment situated at ${agreement.property_location} which you currently occupy expires on the 31st of January 2025. Following the expiry of your tenancy, we hereby make you an offer to rent the apartment for another period upon the following terms:`, { lineGap: 4 });
        doc.moveDown();
        doc
            .font('Helvetica-Bold')
            .text('• Permitted Use:', { continued: true })
            .font('Helvetica')
            .text(' Apartment is not permitted for any other use apart from residential use by the Tenant. Any other use, commercial or otherwise is strictly prohibited.');
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
            .text(' Commencing on the 1st of February 2025 and Expiring on the 31st of January 2026.');
        doc.moveDown();
        doc
            .font('Helvetica')
            .fontSize(11)
            .text(`Please make ALL payments on or before the due date of 31st of January 2025 into the company's account provided below:`, { lineGap: 4 });
        doc.moveDown();
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
        doc.text('Yours faithfully,');
        doc.moveDown();
        doc.font('Helvetica-Bold').text('Olatunji Oginni');
        doc.font('Helvetica').text('Founder/CEO');
        doc.moveDown(3);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(1);
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
exports.generatePdfBufferFromTemplate = generatePdfBufferFromTemplate;
//# sourceMappingURL=pdf-generator.js.map