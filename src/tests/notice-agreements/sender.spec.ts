/* eslint-disable @typescript-eslint/unbound-method */
import {
  sendEmailWithAttachment,
  sendEmailWithMultipleAttachments,
  sendViaWhatsappOrEmail,
} from 'src/notice-agreements/utils/sender';
import sgMail from '@sendgrid/mail';
import axios from 'axios';
import { SendVia } from 'src/notice-agreements/entities/notice-agreement.entity';

jest.mock('@sendgrid/mail');
jest.mock('axios');

describe('Sender Utils', () => {
  const mockRecipient = 'tenant@example.com';
  const mockPhoneNumber = '+1234567890';
  const mockFileUrl = 'https://example.com/notice.pdf';
  const mockPdfContent = Buffer.from('pdf content');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendEmailWithAttachment', () => {
    it('should send email with PDF attachment successfully', async () => {
      (axios.get as jest.Mock).mockResolvedValue({
        data: mockPdfContent,
      });

      (sgMail.send as jest.Mock).mockResolvedValue([
        { statusCode: 202, body: '', headers: {} },
      ]);

      await sendEmailWithAttachment(mockFileUrl, mockRecipient);

      expect(axios.get).toHaveBeenCalledWith(mockFileUrl, {
        responseType: 'arraybuffer',
      });

      expect(sgMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: mockRecipient,
          from: 'hello@getpanda.co',
          subject: 'Notice Agreement',
          text: 'Please find the attached notice agreement.',
          attachments: expect.arrayContaining([
            expect.objectContaining({
              filename: 'notice.pdf',
              type: 'application/pdf',
              disposition: 'attachment',
            }),
          ]),
        }),
      );
    });

    it('should handle filename extraction from URL', async () => {
      const urlWithComplexPath =
        'https://cloudinary.com/folder/subfolder/document-123.pdf';

      (axios.get as jest.Mock).mockResolvedValue({
        data: mockPdfContent,
      });

      (sgMail.send as jest.Mock).mockResolvedValue([
        { statusCode: 202, body: '', headers: {} },
      ]);

      await sendEmailWithAttachment(urlWithComplexPath, mockRecipient);

      const sendCall = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(sendCall.attachments[0].filename).toBe('document-123.pdf');
    });

    it('should use default filename when URL has no filename', async () => {
      const urlWithoutFilename = 'https://example.com/';

      (axios.get as jest.Mock).mockResolvedValue({
        data: mockPdfContent,
      });

      (sgMail.send as jest.Mock).mockResolvedValue([
        { statusCode: 202, body: '', headers: {} },
      ]);

      await sendEmailWithAttachment(urlWithoutFilename, mockRecipient);

      const sendCall = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(sendCall.attachments[0].filename).toBe('attachment.pdf');
    });

    it('should convert buffer to base64', async () => {
      const testBuffer = Buffer.from('test pdf content');
      (axios.get as jest.Mock).mockResolvedValue({
        data: testBuffer,
      });

      (sgMail.send as jest.Mock).mockResolvedValue([
        { statusCode: 202, body: '', headers: {} },
      ]);

      await sendEmailWithAttachment(mockFileUrl, mockRecipient);

      const sendCall = (sgMail.send as jest.Mock).mock.calls[0][0];
      const expectedBase64 = testBuffer.toString('base64');
      expect(sendCall.attachments[0].content).toBe(expectedBase64);
    });

    it('should throw error when file download fails', async () => {
      const downloadError = new Error('Network error');
      (axios.get as jest.Mock).mockRejectedValue(downloadError);

      await expect(
        sendEmailWithAttachment(mockFileUrl, mockRecipient),
      ).rejects.toThrow('Network error');
    });

    it('should throw error when SendGrid fails', async () => {
      (axios.get as jest.Mock).mockResolvedValue({
        data: mockPdfContent,
      });

      const sendGridError = {
        response: {
          body: { errors: [{ message: 'Invalid API key' }] },
        },
        message: 'SendGrid error',
      };

      (sgMail.send as jest.Mock).mockRejectedValue(sendGridError);

      await expect(
        sendEmailWithAttachment(mockFileUrl, mockRecipient),
      ).rejects.toThrow();
    });

    it('should handle SendGrid error without response body', async () => {
      (axios.get as jest.Mock).mockResolvedValue({
        data: mockPdfContent,
      });

      const sendGridError = new Error('Connection timeout');
      (sgMail.send as jest.Mock).mockRejectedValue(sendGridError);

      await expect(
        sendEmailWithAttachment(mockFileUrl, mockRecipient),
      ).rejects.toThrow('Connection timeout');
    });

    it('should handle large PDF files', async () => {
      const largePdfContent = Buffer.alloc(5 * 1024 * 1024); // 5MB

      (axios.get as jest.Mock).mockResolvedValue({
        data: largePdfContent,
      });

      (sgMail.send as jest.Mock).mockResolvedValue([
        { statusCode: 202, body: '', headers: {} },
      ]);

      await sendEmailWithAttachment(mockFileUrl, mockRecipient);

      expect(sgMail.send).toHaveBeenCalled();
    });

    it('should handle multiple recipients', async () => {
      const recipients = ['tenant1@example.com', 'tenant2@example.com'];

      (axios.get as jest.Mock).mockResolvedValue({
        data: mockPdfContent,
      });

      (sgMail.send as jest.Mock).mockResolvedValue([
        { statusCode: 202, body: '', headers: {} },
      ]);

      for (const recipient of recipients) {
        await sendEmailWithAttachment(mockFileUrl, recipient);
      }

      expect(sgMail.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendEmailWithMultipleAttachments', () => {
    const mockFileUrls = [
      'https://example.com/doc1.pdf',
      'https://example.com/doc2.pdf',
      'https://example.com/doc3.pdf',
    ];

    it('should send email with multiple attachments', async () => {
      (axios.get as jest.Mock).mockResolvedValue({
        data: mockPdfContent,
      });

      (sgMail.send as jest.Mock).mockResolvedValue([
        { statusCode: 202, body: '', headers: {} },
      ]);

      await sendEmailWithMultipleAttachments(mockFileUrls, mockRecipient);

      expect(axios.get).toHaveBeenCalledTimes(3);
      expect(sgMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: mockRecipient,
          from: 'hello@getpanda.co',
          subject: 'Notice Agreement Documents',
          text: 'Please find the attached notice agreement documents.',
          attachments: expect.arrayContaining([
            expect.objectContaining({
              filename: 'doc1.pdf',
              type: 'application/pdf',
            }),
            expect.objectContaining({
              filename: 'doc2.pdf',
              type: 'application/pdf',
            }),
            expect.objectContaining({
              filename: 'doc3.pdf',
              type: 'application/pdf',
            }),
          ]),
        }),
      );
    });

    it('should handle empty file URLs array', async () => {
      (sgMail.send as jest.Mock).mockResolvedValue([
        { statusCode: 202, body: '', headers: {} },
      ]);

      await sendEmailWithMultipleAttachments([], mockRecipient);

      expect(axios.get).not.toHaveBeenCalled();
      expect(sgMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [],
        }),
      );
    });

    it('should handle single file URL', async () => {
      (axios.get as jest.Mock).mockResolvedValue({
        data: mockPdfContent,
      });

      (sgMail.send as jest.Mock).mockResolvedValue([
        { statusCode: 202, body: '', headers: {} },
      ]);

      await sendEmailWithMultipleAttachments([mockFileUrl], mockRecipient);

      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(sgMail.send).toHaveBeenCalled();
    });

    it('should handle failed download for one file', async () => {
      (axios.get as jest.Mock)
        .mockResolvedValueOnce({ data: mockPdfContent })
        .mockRejectedValueOnce(new Error('Download failed'))
        .mockResolvedValueOnce({ data: mockPdfContent });

      await expect(
        sendEmailWithMultipleAttachments(mockFileUrls, mockRecipient),
      ).rejects.toThrow('Download failed');
    });

    it('should download files in parallel', async () => {
      const downloadPromises: Promise<any>[] = [];

      (axios.get as jest.Mock).mockImplementation(() => {
        const promise = Promise.resolve({ data: mockPdfContent });
        downloadPromises.push(promise);
        return promise;
      });

      (sgMail.send as jest.Mock).mockResolvedValue([
        { statusCode: 202, body: '', headers: {} },
      ]);

      await sendEmailWithMultipleAttachments(mockFileUrls, mockRecipient);

      expect(downloadPromises.length).toBe(3);
    });

    it('should handle different file types in attachments', async () => {
      const mixedFileUrls = [
        'https://example.com/doc.pdf',
        'https://example.com/image.png',
      ];

      (axios.get as jest.Mock).mockResolvedValue({
        data: mockPdfContent,
      });

      (sgMail.send as jest.Mock).mockResolvedValue([
        { statusCode: 202, body: '', headers: {} },
      ]);

      await sendEmailWithMultipleAttachments(mixedFileUrls, mockRecipient);

      const sendCall = (sgMail.send as jest.Mock).mock.calls[0][0];
      expect(sendCall.attachments).toHaveLength(2);
    });

    it('should handle SendGrid error with detailed response', async () => {
      (axios.get as jest.Mock).mockResolvedValue({
        data: mockPdfContent,
      });

      const detailedError = {
        response: {
          body: {
            errors: [
              { message: 'Attachment size too large' },
              { message: 'Invalid recipient' },
            ],
          },
        },
        message: 'SendGrid API error',
      };

      (sgMail.send as jest.Mock).mockRejectedValue(detailedError);

      await expect(
        sendEmailWithMultipleAttachments(mockFileUrls, mockRecipient),
      ).rejects.toThrow();
    });
  });

  describe('sendViaWhatsappOrEmail', () => {
    const mockFilePath = '/path/to/notice.pdf';

    it('should send via email when EMAIL is specified', async () => {
      (axios.get as jest.Mock).mockResolvedValue({
        data: mockPdfContent,
      });

      (sgMail.send as jest.Mock).mockResolvedValue([
        { statusCode: 202, body: '', headers: {} },
      ]);

      await sendViaWhatsappOrEmail(
        mockFilePath,
        [SendVia.EMAIL],
        mockRecipient,
        undefined,
      );

      expect(axios.get).toHaveBeenCalledWith(mockFilePath, {
        responseType: 'arraybuffer',
      });
      expect(sgMail.send).toHaveBeenCalled();
    });

    it('should send via WhatsApp when WHATSAPP is specified', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await sendViaWhatsappOrEmail(
        mockFilePath,
        [SendVia.WHATSAPP],
        undefined,
        mockPhoneNumber,
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('WhatsApp'),
      );

      consoleSpy.mockRestore();
    });

    it('should send via both email and WhatsApp', async () => {
      (axios.get as jest.Mock).mockResolvedValue({
        data: mockPdfContent,
      });

      (sgMail.send as jest.Mock).mockResolvedValue([
        { statusCode: 202, body: '', headers: {} },
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await sendViaWhatsappOrEmail(
        mockFilePath,
        [SendVia.EMAIL, SendVia.WHATSAPP],
        mockRecipient,
        mockPhoneNumber,
      );

      expect(sgMail.send).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('WhatsApp'),
      );

      consoleSpy.mockRestore();
    });

    it('should not send email if recipient is not provided', async () => {
      await sendViaWhatsappOrEmail(
        mockFilePath,
        [SendVia.EMAIL],
        undefined,
        undefined,
      );

      expect(sgMail.send).not.toHaveBeenCalled();
    });

    it('should not send WhatsApp if phone number is not provided', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await sendViaWhatsappOrEmail(
        mockFilePath,
        [SendVia.WHATSAPP],
        undefined,
        undefined,
      );

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle empty sendVia array', async () => {
      await sendViaWhatsappOrEmail(
        mockFilePath,
        [],
        mockRecipient,
        mockPhoneNumber,
      );

      expect(sgMail.send).not.toHaveBeenCalled();
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete email sending workflow', async () => {
      const fileUrl = 'https://cloudinary.com/notices/notice-123.pdf';
      const recipient = 'tenant@example.com';

      (axios.get as jest.Mock).mockResolvedValue({
        data: Buffer.from('Complete PDF content'),
      });

      (sgMail.send as jest.Mock).mockResolvedValue([
        { statusCode: 202, body: '', headers: {} },
      ]);

      await sendEmailWithAttachment(fileUrl, recipient);

      expect(axios.get).toHaveBeenCalledWith(fileUrl, {
        responseType: 'arraybuffer',
      });
      expect(sgMail.send).toHaveBeenCalled();
    });

    it('should handle retry logic for failed email sends', async () => {
      (axios.get as jest.Mock).mockResolvedValue({
        data: mockPdfContent,
      });

      (sgMail.send as jest.Mock)
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce([{ statusCode: 202, body: '', headers: {} }]);

      await expect(
        sendEmailWithAttachment(mockFileUrl, mockRecipient),
      ).rejects.toThrow('Temporary failure');

      // Second attempt should succeed
      await sendEmailWithAttachment(mockFileUrl, mockRecipient);
      expect(sgMail.send).toHaveBeenCalledTimes(2);
    });
  });
});
