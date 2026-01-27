import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ChatLog } from './entities/chat-log.entity';
import { MessageDirection } from './entities/message-direction.enum';
import { MessageStatus } from './entities/message-status.enum';

export interface ChatHistoryOptions {
  limit?: number;
  offset?: number;
  startDate?: Date;
  endDate?: Date;
  status?: MessageStatus;
  direction?: MessageDirection;
  messageType?: string;
  simulatedOnly?: boolean;
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

export interface SearchOptions {
  phoneNumber?: string;
  content?: string;
  startDate?: Date;
  endDate?: Date;
  status?: MessageStatus;
  direction?: MessageDirection;
  messageType?: string;
  limit?: number;
  offset?: number;
  simulatedOnly?: boolean;
}

@Injectable()
export class ChatHistoryService {
  private readonly logger = new Logger(ChatHistoryService.name);

  constructor(
    @InjectRepository(ChatLog)
    private readonly chatLogRepository: Repository<ChatLog>,
  ) { }

  /**
   * Get chat history with pagination and filtering
   * Validates: Requirements 4.1, 4.2, 4.4, 7.1, 7.3, 7.4
   */
  async getChatHistory(
    phoneNumber: string,
    options: ChatHistoryOptions = {},
  ): Promise<ChatLog[]> {
    try {
      const queryBuilder = this.createBaseQuery();

      // Filter by phone number
      queryBuilder.where('chat_log.phone_number = :phoneNumber', {
        phoneNumber,
      });

      // Apply additional filters
      this.applyFilters(queryBuilder, options);

      // Order chronologically (Requirements 1.3)
      queryBuilder.orderBy('chat_log.created_at', 'ASC');

      // Apply pagination (Requirements 4.1)
      this.applyPagination(queryBuilder, options);

      const results = await queryBuilder.getMany();

      this.logger.debug(
        `Retrieved ${results.length} messages for phone number ${phoneNumber} (options: ${JSON.stringify(options)})`,
      );

      if (results.length === 0) {
        this.logger.debug(
          `No messages found for ${phoneNumber}. Checking if any messages exist for this number...`,
        );
        const count = await this.chatLogRepository.count({
          where: { phone_number: phoneNumber },
        });
        this.logger.debug(`Found ${count} total messages for ${phoneNumber} without filters.`);
      }

      return results;
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
   * Validates: Requirements 4.3
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
      const stats = this.calculateDeliveryStats(messages);

      this.logger.log(
        `Calculated delivery statistics: ${stats.totalMessages} total messages`,
      );
      return stats;
    } catch (error) {
      this.logger.error('Failed to get delivery statistics:', error);
      throw error;
    }
  }

  /**
   * Search messages by phone number and content
   * Validates: Requirements 7.1, 7.2
   */
  async searchMessages(searchOptions: SearchOptions): Promise<ChatLog[]> {
    try {
      const queryBuilder = this.createBaseQuery();

      // Apply search filters with multi-filter combination logic (Requirements 7.5)
      this.applySearchFilters(queryBuilder, searchOptions);

      // Order chronologically
      queryBuilder.orderBy('chat_log.created_at', 'ASC');

      // Apply pagination
      this.applyPagination(queryBuilder, searchOptions);

      const results = await queryBuilder.getMany();

      this.logger.log(`Search returned ${results.length} messages`);
      return results;
    } catch (error) {
      this.logger.error('Failed to search messages:', error);
      throw error;
    }
  }

  /**
   * Search messages by content
   * Validates: Requirements 7.2
   */
  async searchByContent(
    searchTerm: string,
    options: ChatHistoryOptions = {},
  ): Promise<ChatLog[]> {
    try {
      const queryBuilder = this.createBaseQuery();

      // Search in message content (case-insensitive)
      queryBuilder.where('LOWER(chat_log.content) LIKE LOWER(:searchTerm)', {
        searchTerm: `%${searchTerm}%`,
      });

      // Apply additional filters
      this.applyFilters(queryBuilder, options);

      // Order chronologically
      queryBuilder.orderBy('chat_log.created_at', 'ASC');

      // Apply pagination
      this.applyPagination(queryBuilder, options);

      const results = await queryBuilder.getMany();

      this.logger.log(
        `Content search for "${searchTerm}" returned ${results.length} messages`,
      );
      return results;
    } catch (error) {
      this.logger.error(`Failed to search by content "${searchTerm}":`, error);
      throw error;
    }
  }

  /**
   * Get messages by phone number with filtering
   * Validates: Requirements 7.1
   */
  async getMessagesByPhoneNumber(
    phoneNumber: string,
    options: ChatHistoryOptions = {},
  ): Promise<ChatLog[]> {
    try {
      const queryBuilder = this.createBaseQuery();

      queryBuilder.where('chat_log.phone_number = :phoneNumber', {
        phoneNumber,
      });

      // Apply additional filters
      this.applyFilters(queryBuilder, options);

      // Order chronologically
      queryBuilder.orderBy('chat_log.created_at', 'ASC');

      // Apply pagination
      this.applyPagination(queryBuilder, options);

      const results = await queryBuilder.getMany();

      this.logger.log(
        `Retrieved ${results.length} messages for phone number ${phoneNumber}`,
      );
      return results;
    } catch (error) {
      this.logger.error(
        `Failed to get messages for phone number ${phoneNumber}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Create base query with user relationship
   */
  private createBaseQuery(): SelectQueryBuilder<ChatLog> {
    return this.chatLogRepository
      .createQueryBuilder('chat_log')
      .leftJoinAndSelect('chat_log.user', 'user');
  }

  /**
   * Apply filters to query builder
   */
  private applyFilters(
    queryBuilder: SelectQueryBuilder<ChatLog>,
    options: ChatHistoryOptions,
  ): void {
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

    if (options.simulatedOnly === true) {
      this.logger.debug(`Applying simulatedOnly filter for ${queryBuilder.alias}`);
      // Filter for messages that have simulation metadata
      // Enhanced to handle both boolean and string representations in JSONB
      queryBuilder.andWhere(
        "(chat_log.metadata->>'is_simulated' = 'true' OR " +
        "chat_log.metadata->'is_simulated' @> 'true' OR " +
        "chat_log.metadata->>'simulation_status' = 'simulator_message' OR " +
        "chat_log.metadata->>'simulation_status' = 'intercepted_by_simulator' OR " +
        "chat_log.metadata->>'message_source' = 'whatsapp_simulator')",
      );
    }
  }

  /**
   * Apply search filters with multi-filter combination logic
   * Validates: Requirements 7.5
   */
  private applySearchFilters(
    queryBuilder: SelectQueryBuilder<ChatLog>,
    searchOptions: SearchOptions,
  ): void {
    let hasConditions = false;

    if (searchOptions.phoneNumber) {
      queryBuilder.where('chat_log.phone_number = :phoneNumber', {
        phoneNumber: searchOptions.phoneNumber,
      });
      hasConditions = true;
    }

    if (searchOptions.content) {
      const condition = hasConditions ? 'andWhere' : 'where';
      queryBuilder[condition]('LOWER(chat_log.content) LIKE LOWER(:content)', {
        content: `%${searchOptions.content}%`,
      });
      hasConditions = true;
    }

    if (searchOptions.startDate) {
      const condition = hasConditions ? 'andWhere' : 'where';
      queryBuilder[condition]('chat_log.created_at >= :startDate', {
        startDate: searchOptions.startDate,
      });
      hasConditions = true;
    }

    if (searchOptions.endDate) {
      const condition = hasConditions ? 'andWhere' : 'where';
      queryBuilder[condition]('chat_log.created_at <= :endDate', {
        endDate: searchOptions.endDate,
      });
      hasConditions = true;
    }

    if (searchOptions.status) {
      const condition = hasConditions ? 'andWhere' : 'where';
      queryBuilder[condition]('chat_log.status = :status', {
        status: searchOptions.status,
      });
      hasConditions = true;
    }

    if (searchOptions.direction) {
      const condition = hasConditions ? 'andWhere' : 'where';
      queryBuilder[condition]('chat_log.direction = :direction', {
        direction: searchOptions.direction,
      });
      hasConditions = true;
    }

    if (searchOptions.messageType) {
      const condition = hasConditions ? 'andWhere' : 'where';
      queryBuilder[condition]('chat_log.message_type = :messageType', {
        messageType: searchOptions.messageType,
      });
      hasConditions = true;
    }

    if (searchOptions.simulatedOnly === true) {
      const condition = hasConditions ? 'andWhere' : 'where';
      queryBuilder[condition](
        "(chat_log.metadata->>'is_simulated' = 'true' OR " +
        "chat_log.metadata->'is_simulated' @> 'true' OR " +
        "chat_log.metadata->>'simulation_status' = 'simulator_message' OR " +
        "chat_log.metadata->>'simulation_status' = 'intercepted_by_simulator' OR " +
        "chat_log.metadata->>'message_source' = 'whatsapp_simulator')",
      );
      hasConditions = true;
    }

    // If no conditions were applied, add a default condition to avoid returning all records
    if (!hasConditions) {
      queryBuilder.where('1 = 1'); // This ensures we have a valid query
    }
  }

  /**
   * Apply pagination to query builder
   */
  private applyPagination(
    queryBuilder: SelectQueryBuilder<ChatLog>,
    options: { limit?: number; offset?: number },
  ): void {
    if (options.limit) {
      queryBuilder.limit(options.limit);
    }

    if (options.offset) {
      queryBuilder.offset(options.offset);
    }
  }

  /**
   * Calculate delivery statistics from messages
   */
  private calculateDeliveryStats(messages: ChatLog[]): DeliveryStats {
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
        percentage: failedCount > 0 ? (count / failedCount) * 100 : 0,
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
  }

  /**
   * Mark inbound messages as read when landlord views chat
   */
  async markInboundMessagesAsRead(phoneNumber: string): Promise<void> {
    try {
      const result = await this.chatLogRepository.update(
        {
          phone_number: phoneNumber,
          direction: MessageDirection.INBOUND,
          status: MessageStatus.DELIVERED,
        },
        { status: MessageStatus.READ },
      );

      this.logger.log(
        `Marked ${result.affected} inbound messages as read for ${phoneNumber}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to mark inbound messages as read for ${phoneNumber}:`,
        error,
      );
      throw error;
    }
  }
}
