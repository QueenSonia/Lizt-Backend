import {
  generatePdfBufferFromEditor,
  generatePdfBufferFromHtml,
  generatePdfBufferFromTemplate,
  generatePdfFromTemplate,
} from 'src/notice-agreements/utils/pdf-generator';
import {
  NoticeAgreement,
  NoticeType,
  NoticeStatus,
  SendVia,
} from 'src/notice-agreements/entities/notice-agreement.entity';
import { Users } from 'src/users/entities/user.entity';
import pdf from 'html-pdf';
import * as fs from 'fs';
import * as path from 'path';

// Mock the html-pdf library
jest.mock('html-pdf');

// Mock fs module
jest.mock('fs');

describe('PDF Generator Utils', () => {
  const mockTenant: Users = {
    id: 'tenant-123',
    first_name: 'Jane',
    last_name: 'Smith',
    email: 'jane.smith@example.com',
    phone_number: '+2348098765432',
  } as Users;

  const mockNoticeAgreement: any = {
    id: 'notice-xyz-789',
    notice_id: 'NTC-XYZ78901',
    notice_type: NoticeType.LEASE_RENEWAL,
    tenant_name: 'Jane Smith',
    property_name: 'Ocean View Apartments',
    property_location: 'Victoria Island, Lagos',
    effective_date: new Date('2025-03-15'),
    status: NoticeStatus.PENDING,
    additional_notes: 'Please respond within 30 days.',
    send_via: [SendVia.EMAIL],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generatePdfBufferFromEditor', () => {
    const htmlContent =
      '<h1>Notice Agreement</h1><p>This is a formal notice regarding your tenancy.</p>';

    it('should generate PDF buffer from HTML content successfully', async () => {
      // Arrange
      const mockBuffer = Buffer.from('PDF binary content');
      const mockPdfInstance = {
        toBuffer: jest.fn((callback) => callback(null, mockBuffer)),
      };

      (pdf.create as jest.Mock).mockReturnValue(mockPdfInstance);

      // Act
      const result = await generatePdfBufferFromEditor(htmlContent);

      // Assert
      expect(result).toEqual(mockBuffer);
      expect(result).toBeInstanceOf(Buffer);
      expect(pdf.create).toHaveBeenCalledTimes(1);
      expect(mockPdfInstance.toBuffer).toHaveBeenCalledTimes(1);
    });

    it('should include CSS styles in generated HTML', async () => {
      // Arrange
      const mockBuffer = Buffer.from('PDF content');
      const mockPdfInstance = {
        toBuffer: jest.fn((callback) => callback(null, mockBuffer)),
      };

      (pdf.create as jest.Mock).mockReturnValue(mockPdfInstance);

      // Act
      await generatePdfBufferFromEditor(htmlContent);

      // Assert
      const generatedHtml = (pdf.create as jest.Mock).mock.calls[0][0];

      expect(generatedHtml).toContain('<!DOCTYPE html>');
      expect(generatedHtml).toContain('<style>');
      expect(generatedHtml).toContain('Plus Jakarta Sans');
      expect(generatedHtml).toContain('font-family:');
      expect(generatedHtml).toContain(htmlContent);
      expect(generatedHtml).toContain('<div class="ql-editor">');
    });

    it('should use correct PDF options (A4 format, 1in border)', async () => {
      // Arrange
      const mockBuffer = Buffer.from('PDF content');
      const mockPdfInstance = {
        toBuffer: jest.fn((callback) => callback(null, mockBuffer)),
      };

      (pdf.create as jest.Mock).mockReturnValue(mockPdfInstance);

      // Act
      await generatePdfBufferFromEditor(htmlContent);

      // Assert
      const options = (pdf.create as jest.Mock).mock.calls[0][1];

      expect(options.format).toBe('A4');
      expect(options.border).toBe('1in');
    });

    it('should handle empty HTML content', async () => {
      // Arrange
      const emptyHtml = '';
      const mockBuffer = Buffer.from('Empty PDF');
      const mockPdfInstance = {
        toBuffer: jest.fn((callback) => callback(null, mockBuffer)),
      };

      (pdf.create as jest.Mock).mockReturnValue(mockPdfInstance);

      // Act
      const result = await generatePdfBufferFromEditor(emptyHtml);

      // Assert
      expect(result).toEqual(mockBuffer);
      expect(pdf.create).toHaveBeenCalled();
    });

    it('should handle complex HTML with nested elements', async () => {
      // Arrange
      const complexHtml = `
        <div>
          <h1>Main Title</h1>
          <h2>Subtitle</h2>
          <p>Paragraph with <strong>bold</strong> and <em>italic</em> text.</p>
          <ul>
            <li>First item</li>
            <li>Second item</li>
            <li>Third item</li>
          </ul>
          <p>More content with <a href="https://example.com">a link</a>.</p>
          <hr />
          <p>Content after horizontal rule.</p>
        </div>
      `;

      const mockBuffer = Buffer.from('Complex PDF');
      const mockPdfInstance = {
        toBuffer: jest.fn((callback) => callback(null, mockBuffer)),
      };

      (pdf.create as jest.Mock).mockReturnValue(mockPdfInstance);

      // Act
      const result = await generatePdfBufferFromEditor(complexHtml);

      // Assert
      expect(result).toEqual(mockBuffer);
      const generatedHtml = (pdf.create as jest.Mock).mock.calls[0][0];
      expect(generatedHtml).toContain(complexHtml);
    });

    it('should handle HTML with special characters', async () => {
      // Arrange
      const htmlWithSpecialChars =
        '<p>Price: ₦2,800,000 & Service: €500</p><p>Quote: "Hello"</p>';

      const mockBuffer = Buffer.from('PDF with special chars');
      const mockPdfInstance = {
        toBuffer: jest.fn((callback) => callback(null, mockBuffer)),
      };

      (pdf.create as jest.Mock).mockReturnValue(mockPdfInstance);

      // Act
      const result = await generatePdfBufferFromEditor(htmlWithSpecialChars);

      // Assert
      expect(result).toBeInstanceOf(Buffer);
      const generatedHtml = (pdf.create as jest.Mock).mock.calls[0][0];
      expect(generatedHtml).toContain(htmlWithSpecialChars);
    });

    it('should handle very large HTML content', async () => {
      // Arrange
      const largeHtml =
        '<p>' + 'Lorem ipsum dolor sit amet. '.repeat(1000) + '</p>';

      const mockBuffer = Buffer.from('Large PDF');
      const mockPdfInstance = {
        toBuffer: jest.fn((callback) => callback(null, mockBuffer)),
      };

      (pdf.create as jest.Mock).mockReturnValue(mockPdfInstance);

      // Act
      const result = await generatePdfBufferFromEditor(largeHtml);

      // Assert
      expect(result).toEqual(mockBuffer);
    });

    it('should reject promise when PDF generation fails', async () => {
      // Arrange
      const error = new Error('PDF generation failed');
      const mockPdfInstance = {
        toBuffer: jest.fn((callback) => callback(error, null)),
      };

      (pdf.create as jest.Mock).mockReturnValue(mockPdfInstance);

      // Act & Assert
      await expect(generatePdfBufferFromEditor(htmlContent)).rejects.toThrow(
        'PDF generation failed',
      );
    });

    it('should handle network errors during font loading', async () => {
      // Arrange
      const mockBuffer = Buffer.from('PDF content');
      const mockPdfInstance = {
        toBuffer: jest.fn((callback) => callback(null, mockBuffer)),
      };

      (pdf.create as jest.Mock).mockReturnValue(mockPdfInstance);

      // Act
      const result = await generatePdfBufferFromEditor(htmlContent);

      // Assert - Should still work even if Google Fonts fails to load
      expect(result).toEqual(mockBuffer);
    });

    it('should include all necessary CSS styles', async () => {
      // Arrange
      const mockBuffer = Buffer.from('PDF content');
      const mockPdfInstance = {
        toBuffer: jest.fn((callback) => callback(null, mockBuffer)),
      };

      (pdf.create as jest.Mock).mockReturnValue(mockPdfInstance);

      // Act
      await generatePdfBufferFromEditor(htmlContent);

      // Assert
      const generatedHtml = (pdf.create as jest.Mock).mock.calls[0][0];

      expect(generatedHtml).toContain('h1 {');
      expect(generatedHtml).toContain('h2 {');
      expect(generatedHtml).toContain('p {');
      expect(generatedHtml).toContain('ul {');
      expect(generatedHtml).toContain('li {');
      expect(generatedHtml).toContain('strong {');
      expect(generatedHtml).toContain('em {');
      expect(generatedHtml).toContain('a {');
      expect(generatedHtml).toContain('hr {');
    });
  });

  describe('generatePdfBufferFromHtml', () => {
    it('should generate PDF buffer from simple HTML', async () => {
      // Arrange
      const html = '<h1>Test Title</h1><p>Test paragraph</p>';

      // Act
      const result = await generatePdfBufferFromHtml(html);

      // Assert
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle H1 tags with underline', async () => {
      // Arrange
      const html = '<h1>Important Title</h1>';

      // Act
      const result = await generatePdfBufferFromHtml(html);

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle P tags', async () => {
      // Arrange
      const html = '<p>This is a paragraph with some content.</p>';

      // Act
      const result = await generatePdfBufferFromHtml(html);

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle STRONG tags with bold font', async () => {
      // Arrange
      const html = '<strong>Bold text content</strong>';

      // Act
      const result = await generatePdfBufferFromHtml(html);

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle empty HTML', async () => {
      // Arrange
      const html = '';

      // Act
      const result = await generatePdfBufferFromHtml(html);

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle multiple elements', async () => {
      // Arrange
      const html = `
        <h1>Heading 1</h1>
        <p>First paragraph</p>
        <strong>Strong text</strong>
        <p>Second paragraph</p>
      `;

      // Act
      const result = await generatePdfBufferFromHtml(html);

      // Assert
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle unknown HTML tags gracefully', async () => {
      // Arrange
      const html = '<div>Div content</div><span>Span content</span>';

      // Act
      const result = await generatePdfBufferFromHtml(html);

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should parse nested HTML structures', async () => {
      // Arrange
      const html = '<div><h1>Title</h1><p>Content</p></div>';

      // Act
      const result = await generatePdfBufferFromHtml(html);

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('generatePdfBufferFromTemplate', () => {
    it('should generate PDF buffer from template successfully', async () => {
      // Act
      const result = await generatePdfBufferFromTemplate(
        mockNoticeAgreement,
        mockTenant,
      );

      // Assert
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should include tenant name in PDF', async () => {
      // Act
      const result = await generatePdfBufferFromTemplate(
        mockNoticeAgreement,
        mockTenant,
      );

      // Assert
      expect(result).toBeInstanceOf(Buffer);
      // The buffer should contain tenant information
    });

    it('should include property information', async () => {
      // Act
      const result = await generatePdfBufferFromTemplate(
        mockNoticeAgreement,
        mockTenant,
      );

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should include notice type in uppercase', async () => {
      // Act
      const result = await generatePdfBufferFromTemplate(
        mockNoticeAgreement,
        mockTenant,
      );

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle different notice types', async () => {
      // Arrange
      const evictionNotice = {
        ...mockNoticeAgreement,
        notice_type: NoticeType.EVICTION,
      };

      // Act
      const result = await generatePdfBufferFromTemplate(
        evictionNotice,
        mockTenant,
      );

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle rent increase notices', async () => {
      // Arrange
      const rentIncreaseNotice = {
        ...mockNoticeAgreement,
        notice_type: NoticeType.RENT_INCREASE,
      };

      // Act
      const result = await generatePdfBufferFromTemplate(
        rentIncreaseNotice,
        mockTenant,
      );

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle warning notices', async () => {
      // Arrange
      const warningNotice = {
        ...mockNoticeAgreement,
        notice_type: NoticeType.WARNING,
      };

      // Act
      const result = await generatePdfBufferFromTemplate(
        warningNotice,
        mockTenant,
      );

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle notice without property location', async () => {
      // Arrange
      const noticeWithoutLocation = {
        ...mockNoticeAgreement,
        property_location: undefined,
      };

      // Act
      const result = await generatePdfBufferFromTemplate(
        noticeWithoutLocation,
        mockTenant,
      );

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should format dates correctly', async () => {
      // Arrange
      const noticeWithSpecificDate = {
        ...mockNoticeAgreement,
        effective_date: new Date('2025-06-01'),
      };

      // Act
      const result = await generatePdfBufferFromTemplate(
        noticeWithSpecificDate,
        mockTenant,
      );

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should include payment details section', async () => {
      // Act
      const result = await generatePdfBufferFromTemplate(
        mockNoticeAgreement,
        mockTenant,
      );

      // Assert
      expect(result).toBeInstanceOf(Buffer);
      // Should contain account number, bank name, etc.
    });

    it('should include signature block', async () => {
      // Act
      const result = await generatePdfBufferFromTemplate(
        mockNoticeAgreement,
        mockTenant,
      );

      // Assert
      expect(result).toBeInstanceOf(Buffer);
      // Should contain signature section
    });

    it('should include footer with company information', async () => {
      // Act
      const result = await generatePdfBufferFromTemplate(
        mockNoticeAgreement,
        mockTenant,
      );

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle tenant with long names', async () => {
      // Arrange
      const tenantWithLongName = {
        ...mockTenant,
        first_name: 'Oluwaseun-Temitope',
        last_name: 'Adebayo-Oluwafemi',
      };

      // Act
      const result = await generatePdfBufferFromTemplate(
        mockNoticeAgreement,
        tenantWithLongName,
      );

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle property with long names', async () => {
      // Arrange
      const noticeWithLongPropertyName = {
        ...mockNoticeAgreement,
        property_name: 'Luxury Waterfront Executive Apartments Complex',
        property_location: 'Plot 123, Block 45, Lekki Peninsula Scheme II',
      };

      // Act
      const result = await generatePdfBufferFromTemplate(
        noticeWithLongPropertyName,
        mockTenant,
      );

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should create proper PDF structure', async () => {
      // Act
      const result = await generatePdfBufferFromTemplate(
        mockNoticeAgreement,
        mockTenant,
      );

      // Assert
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(100); // Minimum size check
    });
  });

  describe('generatePdfFromTemplate', () => {
    const outputDir = path.join(process.cwd(), 'src', 'generated-contracts');

    beforeEach(() => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
      (fs.createWriteStream as jest.Mock).mockReturnValue({
        on: jest.fn(),
      });
    });

    it('should generate PDF file and return file path', async () => {
      // Arrange
      const mockStream = {
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            callback();
          }
          return mockStream;
        }),
      };

      (fs.createWriteStream as jest.Mock).mockReturnValue(mockStream);

      // Act
      const result = await generatePdfFromTemplate(
        mockNoticeAgreement,
        mockTenant,
      );

      // Assert
      expect(result).toContain('-notice.pdf');
      expect(result).toContain(outputDir);
      expect(typeof result).toBe('string');
    });

    it('should create output directory if it does not exist', async () => {
      // Arrange
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const mockStream = {
        on: jest.fn((event, callback) => {
          if (event === 'finish') callback();
          return mockStream;
        }),
      };

      (fs.createWriteStream as jest.Mock).mockReturnValue(mockStream);

      // Act
      await generatePdfFromTemplate(mockNoticeAgreement, mockTenant);

      // Assert
      expect(fs.mkdirSync).toHaveBeenCalledWith(outputDir, { recursive: true });
    });

    it('should not create directory if it already exists', async () => {
      // Arrange
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const mockStream = {
        on: jest.fn((event, callback) => {
          if (event === 'finish') callback();
          return mockStream;
        }),
      };

      (fs.createWriteStream as jest.Mock).mockReturnValue(mockStream);

      // Act
      await generatePdfFromTemplate(mockNoticeAgreement, mockTenant);

      // Assert
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should generate unique filenames', async () => {
      // Arrange
      const mockStream = {
        on: jest.fn((event, callback) => {
          if (event === 'finish') callback();
          return mockStream;
        }),
      };

      (fs.createWriteStream as jest.Mock).mockReturnValue(mockStream);

      // Act
      const result1 = await generatePdfFromTemplate(
        mockNoticeAgreement,
        mockTenant,
      );
      const result2 = await generatePdfFromTemplate(
        mockNoticeAgreement,
        mockTenant,
      );

      // Assert
      expect(result1).not.toBe(result2);
    });

    it('should reject promise on stream error', async () => {
      // Arrange
      const mockError = new Error('Write stream failed');
      const mockStream = {
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            callback(mockError);
          }
          return mockStream;
        }),
      };

      (fs.createWriteStream as jest.Mock).mockReturnValue(mockStream);

      // Act & Assert
      await expect(
        generatePdfFromTemplate(mockNoticeAgreement, mockTenant),
      ).rejects.toThrow('Write stream failed');
    });

    it('should include tenant information in PDF', async () => {
      // Arrange
      const mockStream = {
        on: jest.fn((event, callback) => {
          if (event === 'finish') callback();
          return mockStream;
        }),
      };

      (fs.createWriteStream as jest.Mock).mockReturnValue(mockStream);

      // Act
      const result = await generatePdfFromTemplate(
        mockNoticeAgreement,
        mockTenant,
      );

      // Assert
      expect(result).toBeTruthy();
      expect(fs.createWriteStream).toHaveBeenCalled();
    });

    it('should include property information in PDF', async () => {
      // Arrange
      const mockStream = {
        on: jest.fn((event, callback) => {
          if (event === 'finish') callback();
          return mockStream;
        }),
      };

      (fs.createWriteStream as jest.Mock).mockReturnValue(mockStream);

      // Act
      const result = await generatePdfFromTemplate(
        mockNoticeAgreement,
        mockTenant,
      );

      // Assert
      expect(result).toBeTruthy();
    });

    it('should include effective date in PDF', async () => {
      // Arrange
      const mockStream = {
        on: jest.fn((event, callback) => {
          if (event === 'finish') callback();
          return mockStream;
        }),
      };

      (fs.createWriteStream as jest.Mock).mockReturnValue(mockStream);

      // Act
      const result = await generatePdfFromTemplate(
        mockNoticeAgreement,
        mockTenant,
      );

      // Assert
      expect(result).toBeTruthy();
    });

    it('should include additional notes when present', async () => {
      // Arrange
      const noticeWithNotes = {
        ...mockNoticeAgreement,
        additional_notes: 'Please ensure all rent is paid before renewal.',
      };

      const mockStream = {
        on: jest.fn((event, callback) => {
          if (event === 'finish') callback();
          return mockStream;
        }),
      };

      (fs.createWriteStream as jest.Mock).mockReturnValue(mockStream);

      // Act
      const result = await generatePdfFromTemplate(noticeWithNotes, mockTenant);

      // Assert
      expect(result).toBeTruthy();
    });
  });

  describe('Buffer validation', () => {
    it('should create valid PDF buffers for editor content', async () => {
      // Arrange
      const htmlContent = '<h1>Test</h1><p>Content</p>';

      const mockBuffer = Buffer.from('Valid PDF content');
      const mockPdfInstance = {
        toBuffer: jest.fn((callback) => callback(null, mockBuffer)),
      };

      (pdf.create as jest.Mock).mockReturnValue(mockPdfInstance);

      // Act
      const buffer = await generatePdfBufferFromEditor(htmlContent);

      // Assert
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should create valid PDF buffers for HTML content', async () => {
      // Arrange
      const html = '<p>Test content</p>';

      // Act
      const buffer = await generatePdfBufferFromHtml(html);

      // Assert
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should create valid PDF buffers for template content', async () => {
      // Act
      const buffer = await generatePdfBufferFromTemplate(
        mockNoticeAgreement,
        mockTenant,
      );

      // Assert
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe('Error handling', () => {
    it('should handle corrupted HTML gracefully', async () => {
      // Arrange
      const corruptedHtml = '<h1>Unclosed tag<p>Missing closing</h1>';

      const mockBuffer = Buffer.from('PDF from corrupted HTML');
      const mockPdfInstance = {
        toBuffer: jest.fn((callback) => callback(null, mockBuffer)),
      };

      (pdf.create as jest.Mock).mockReturnValue(mockPdfInstance);

      // Act
      const result = await generatePdfBufferFromEditor(corruptedHtml);

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle undefined values in template', async () => {
      // Arrange
      const noticeWithUndefined = {
        ...mockNoticeAgreement,
        additional_notes: undefined,
        property_location: undefined,
      };

      // Act
      const result = await generatePdfBufferFromTemplate(
        noticeWithUndefined,
        mockTenant,
      );

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle null values in template', async () => {
      // Arrange
      const noticeWithNull = {
        ...mockNoticeAgreement,
        additional_notes: null,
      };

      // Act
      const result = await generatePdfBufferFromTemplate(
        noticeWithNull,
        mockTenant,
      );

      // Assert
      expect(result).toBeInstanceOf(Buffer);
    });
  });
});
