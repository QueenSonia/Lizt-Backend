import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatLog } from './entities/chat-log.entity';
import { MessageDirection } from './entities/message-direction.enum';
import { MessageStatus } from './entities/message-status.enum';
import { Users } from '../users/entities/user.entity';

export interface ChatHistoryOptions {
  limit?: number;
  offset?: number;
  startDate?: Date;
  endDate?: Date;
  status?: MessageStatus;
  direction?: MessageDirection;
  messageType?: string;
}

export interface DeliveryStats {
  totalMessages: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  deliveryRate: number;
  readRate: number;
  commonErrors: ErrorSummary[];
}

export interface ErrorSummary {
  errorCode: string;
  errorReason: string;
  count: number;
  percentage: number;
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

@Injectable()
export class ChatLogService {
  private readonly logger = new Logger(ChatLogService.name);

  constructor(
    @InjectRepository(ChatLog)
    private readonly chatLogRepository: Repository<ChatLog>,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
  ) {}

  /**
   * Log an inbound message (Tenant -> Bot)
   * Validates: Requirements 1.1
   */
  async logInboundMessage(
    phoneNumber: string,
    messageType: string,
    content: string,
    metadata: any,
  ): Promise<ChatLog> {
    try {
      const chatLog = this.chatLogRepository.create({
        phone_number: phoneNumber,
        direction: MessageDirection.INBOUND,
        message_type: messageType,
        content,
        metadata,
        status: MessageStatus.SENT, // Inbound messages are considered "sent" by the user
      });

      const savedLog = await this.chatLogRepository.save(chatLog);

      // Attempt to link to user if phone number matches
      await this.tryLinkUserToMessage(savedLog.id, phoneNumber);

      this.logger.log(
        `Logged inbound message from ${phoneNumber}: ${messageType}`,
      );
      return savedLog;
    } catch (error) {
      this.logger.error(
        `Failed to log inbound message from ${phoneNumber}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Log an outbound message (Bot -> Tenant)
   * Validates: Requirements 1.2
   */
  async logOutboundMessage(
    phoneNumber: string,
    messageType: string,
    content: string,
    metadata: any,
    whatsappMessageId?: string,
  ): Promise<ChatLog> {
    try {
      const chatLog = this.chatLogRepository.create({
        phone_number: phoneNumber,
        direction: MessageDirection.OUTBOUND,
        message_type: messageType,
        content,
        metadata,
        whatsapp_message_id: whatsappMessageId,
        status: MessageStatus.SENT,
      });

      const savedLog = await this.chatLogRepository.save(chatLog);

      // Attempt to link to user if phone number matches
      await this.tryLinkUserToMessage(savedLog.id, phoneNumber);

      this.logger.log(
        `Logged outbound message to ${phoneNumber}: ${messageType}`,
      );
      return savedLog;
    } catch (error) {
      this.logger.error(
        `Failed to log outbound message to ${phoneNumber}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Update message status based on webhook updates
   * Validates: Requirements 2.2
   */
  async updateMessageStatus(
    wamid: string,
    status: MessageStatus,
    errorCode?: string,
    errorReason?: string,
  ): Promise<void> {
    try {
      const result = await this.chatLogRepository.update(
        { whatsapp_message_id: wamid },
        {
          status,
          error_code: errorCode,
          error_reason: errorReason,
        },
      );

      if (result.affected === 0) {
        this.logger.warn(`No message found with WAMID: ${wamid}`);
        return;
      }

      this.logger.log(`Updated message status for WAMID ${wamid} to ${status}`);
    } catch (error) {
      this.logger.error(
        `Failed to update message status for WAMID ${wamid}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Link a chat message to a user entity
   * Validates: Requirements 6.3
   */
  async linkUserToMessage(messageId: string, userId: string): Promise<void> {
    try {
      const result = await this.chatLogRepository.update(
        { id: messageId },
        { user_id: userId },
      );

      if (result.affected === 0) {
        this.logger.warn(`No message found with ID: ${messageId}`);
        return;
      }

      this.logger.log(`Linked message ${messageId} to user ${userId}`);
    } catch (error) {
      this.logger.error(
        `Failed to link message ${messageId} to user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get chat history for a specific phone number with filtering options
   */
  async getChatHistory(
    phoneNumber: string,
    options: ChatHistoryOptions = {},
  ): Promise<ChatLog[]> {
    try {
      const queryBuilder = this.chatLogRepository
        .createQueryBuilder('chat_log')
        .leftJoinAndSelect('chat_log.user', 'user')
        .where('chat_log.phone_number = :phoneNumber', { phoneNumber });

      // Apply filters
      if (options.startDate) {
        queryBuilder.andWhere('chat_log.created_at >= :startDate', {
          startDate: options.startDate,
        });
      }

      if (options.endDate) {
        queryBuilder.andWhere('chat_log.created_at <= :endDate', {
          endDate: options.endDate,
        });
      }

      if (options.status) {
        queryBuilder.andWhere('chat_log.status = :status', {
          status: options.status,
        });
      }

      if (options.direction) {
        queryBuilder.andWhere('chat_log.direction = :direction', {
          direction: options.direction,
        });
      }

      if (options.messageType) {
        queryBuilder.andWhere('chat_log.message_type = :messageType', {
          messageType: options.messageType,
        });
      }

      // Order by creation time (chronological)
      queryBuilder.orderBy('chat_log.created_at', 'ASC');

      // Apply pagination
      if (options.limit) {
        queryBuilder.limit(options.limit);
      }

      if (options.offset) {
        queryBuilder.offset(options.offset);
      }

      return await queryBuilder.getMany();
    } catch (error) {
      this.logger.error(
        `Failed to get chat history for ${phoneNumber}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get delivery statistics for messages
   */
  async getDeliveryStatistics(
    phoneNumber?: string,
    dateRange?: DateRange,
  ): Promise<DeliveryStats> {
    try {
      const queryBuilder = this.chatLogRepository
        .createQueryBuilder('chat_log')
        .where('chat_log.direction = :direction', {
          direction: MessageDirection.OUTBOUND,
        });

      if (phoneNumber) {
        queryBuilder.andWhere('chat_log.phone_number = :phoneNumber', {
          phoneNumber,
        });
      }

      if (dateRange) {
        queryBuilder.andWhere(
          'chat_log.created_at BETWEEN :startDate AND :endDate',
          {
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
          },
        );
      }

      const messages = await queryBuilder.getMany();
      const totalMessages = messages.length;

      if (totalMessages === 0) {
        return {
          totalMessages: 0,
          sentCount: 0,
          deliveredCount: 0,
          readCount: 0,
          failedCount: 0,
          deliveryRate: 0,
          readRate: 0,
          commonErrors: [],
        };
      }

      const sentCount = messages.filter(
        (m) => m.status === MessageStatus.SENT,
      ).length;
      const deliveredCount = messages.filter(
        (m) => m.status === MessageStatus.DELIVERED,
      ).length;
      const readCount = messages.filter(
        (m) => m.status === MessageStatus.READ,
      ).length;
      const failedCount = messages.filter(
        (m) => m.status === MessageStatus.FAILED,
      ).length;

      const deliveryRate = ((deliveredCount + readCount) / totalMessages) * 100;
      const readRate = (readCount / totalMessages) * 100;

      // Calculate common errors
      const errorCounts = new Map<string, { count: number; reason: string }>();
      messages
        .filter((m) => m.status === MessageStatus.FAILED && m.error_code)
        .forEach((m) => {
          const key = m.error_code;
          const existing = errorCounts.get(key) || {
            count: 0,
            reason: m.error_reason || 'Unknown error',
          };
          errorCounts.set(key, { ...existing, count: existing.count + 1 });
        });

      const commonErrors: ErrorSummary[] = Array.from(errorCounts.entries())
        .map(([errorCode, { count, reason }]) => ({
          errorCode,
          errorReason: reason,
          count,
          percentage: (count / failedCount) * 100,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10); // Top 10 errors

      return {
        totalMessages,
        sentCount,
        deliveredCount,
        readCount,
        failedCount,
        deliveryRate: Math.round(deliveryRate * 100) / 100,
        readRate: Math.round(readRate * 100) / 100,
        commonErrors,
      };
    } catch (error) {
      this.logger.error('Failed to get delivery statistics:', error);
      throw error;
    }
  }

  /**
   * Private helper method to automatically link messages to users based on phone number
   */
  private async tryLinkUserToMessage(
    messageId: string,
    phoneNumber: string,
  ): Promise<void> {
    try {
      const user = await this.usersRepository.findOne({
        where: { phone_number: phoneNumber },
      });

      if (user) {
        await this.linkUserToMessage(messageId, user.id);
      }
    } catch (error) {
      // Don't throw error for linking failures - it's optional
      this.logger.debug(
        `Could not link message ${messageId} to user with phone ${phoneNumber}:`,
        error,
      );
    }
  }
}
