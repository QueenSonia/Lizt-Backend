import { Injectable, Logger } from '@nestjs/common';
import { ChatLogService } from './chat-log.service';
import { MessageStatus } from './entities/message-status.enum';

export interface WhatsAppStatusUpdate {
  id: string; // WAMID
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: WhatsAppError[];
}

export interface WhatsAppError {
  code: number;
  title: string;
  message?: string;
  error_data?: any;
}

@Injectable()
export class MessageStatusTracker {
  private readonly logger = new Logger(MessageStatusTracker.name);

  // Comprehensive error code mapping as per Requirements 3.2
  private readonly ERROR_CODE_MAPPING = {
    // Delivery Failures
    '131026': 'Phone number not on WhatsApp or user blocked business',
    '131047': '24-hour messaging window expired - template message required',
    '131048': 'Rate limit exceeded - too many messages sent',
    '131049':
      'Message blocked to protect ecosystem - wait 24+ hours before retry',
    '131051': 'Unsupported message type for current session',
    '131053': 'Media upload failed - check file type and size',

    // Rate Limits
    '130429': 'Throughput rate limit hit - reduce sending speed',
    '131056': 'Per-user rate limit hit - wait before sending more messages',

    // Account Issues
    '368': 'Account temporarily blocked - check WhatsApp Manager',
    '131031': 'Account locked due to policy violations',

    // Template Issues
    '132000': 'Template parameter count mismatch',
    '132001': 'Template not found or not approved',
    '132007': 'Template violates policy',

    // Generic
    '131000': 'Generic error - retry later or check request format',
    '131021': 'Recipient cannot be the sender (testing error)',
    '131052': 'Media download error',
  };

  constructor(private readonly chatLogService: ChatLogService) {}

  /**
   * Process a status update from WhatsApp webhook
   * Validates: Requirements 2.2, 2.3, 2.4, 2.5
   */
  async processStatusUpdate(statusUpdate: WhatsAppStatusUpdate): Promise<void> {
    try {
      const { id: wamid, status, errors } = statusUpdate;

      this.logger.log(`Processing status update for WAMID ${wamid}: ${status}`);

      switch (status) {
        case 'delivered':
          await this.handleDeliveryConfirmation(wamid);
          break;
        case 'read':
          await this.handleReadReceipt(wamid);
          break;
        case 'failed':
          if (errors && errors.length > 0) {
            await this.handleDeliveryFailure(wamid, errors[0]);
          } else {
            // Handle failure without specific error
            await this.handleDeliveryFailure(wamid, {
              code: 131000,
              title: 'Generic error',
              message: 'Message failed without specific error details',
            });
          }
          break;
        case 'sent':
          // Message was successfully sent to Meta API - no status change needed
          // as messages are already marked as SENT when logged
          this.logger.debug(`Message ${wamid} confirmed sent to Meta API`);
          break;
        default:
          this.logger.warn(
            `Unknown status received: ${status} for WAMID ${wamid}`,
          );
      }
    } catch (error) {
      this.logger.error(
        `Failed to process status update for WAMID ${statusUpdate.id}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Handle delivery confirmation
   * Validates: Requirements 2.3
   */
  async handleDeliveryConfirmation(wamid: string): Promise<void> {
    try {
      await this.chatLogService.updateMessageStatus(
        wamid,
        MessageStatus.DELIVERED,
      );
      this.logger.log(`Message ${wamid} marked as delivered`);
    } catch (error) {
      this.logger.error(
        `Failed to handle delivery confirmation for WAMID ${wamid}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Handle read receipt
   * Validates: Requirements 2.4
   */
  async handleReadReceipt(wamid: string): Promise<void> {
    try {
      await this.chatLogService.updateMessageStatus(wamid, MessageStatus.READ);
      this.logger.log(`Message ${wamid} marked as read`);
    } catch (error) {
      this.logger.error(
        `Failed to handle read receipt for WAMID ${wamid}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Handle delivery failure
   * Validates: Requirements 2.5, 3.1
   */
  async handleDeliveryFailure(
    wamid: string,
    error: WhatsAppError,
  ): Promise<void> {
    try {
      const errorCode = error.code.toString();
      const errorReason = this.mapErrorCodeToReason(errorCode);

      await this.chatLogService.updateMessageStatus(
        wamid,
        MessageStatus.FAILED,
        errorCode,
        errorReason,
      );

      this.logger.warn(
        `Message ${wamid} failed with error ${errorCode}: ${errorReason}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle delivery failure for WAMID ${wamid}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Map WhatsApp error code to human-readable reason
   * Validates: Requirements 3.2
   */
  private mapErrorCodeToReason(errorCode: string): string {
    return (
      this.ERROR_CODE_MAPPING[errorCode] || `Unknown error code: ${errorCode}`
    );
  }

  /**
   * Get all supported error codes and their meanings
   * Useful for documentation and debugging
   */
  getSupportedErrorCodes(): Record<string, string> {
    return { ...this.ERROR_CODE_MAPPING };
  }

  /**
   * Check if an error code is supported
   */
  isErrorCodeSupported(errorCode: string): boolean {
    return errorCode in this.ERROR_CODE_MAPPING;
  }
}
