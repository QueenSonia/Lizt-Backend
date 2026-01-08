import {
  Controller,
  Get,
  Param,
  Query,
  HttpException,
  HttpStatus,
  Logger,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { ChatHistoryService } from './chat-history.service';
import {
  ChatHistoryQueryDto,
  MessageSearchDto,
  ChatHistoryResponseDto,
  DeliveryStatsDto,
  SearchResultsDto,
} from './dto';
import { MessageStatus } from './entities/message-status.enum';
import { MessageDirection } from './entities/message-direction.enum';

import { UtilService } from 'src/utils/utility-service';

@Controller('chat-history')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ChatHistoryController {
  private readonly logger = new Logger(ChatHistoryController.name);

  constructor(
    private readonly chatHistoryService: ChatHistoryService,
    private readonly utilService: UtilService,
  ) { }

  /**
   * Get chat history for a specific phone number
   * Validates: Requirements 4.1, 4.2, 4.4, 4.5, 7.1, 7.4
   */
  @Get(':phoneNumber')
  async getChatHistory(
    @Param('phoneNumber') phoneNumber: string,
    @Query() queryDto: ChatHistoryQueryDto,
  ): Promise<ChatHistoryResponseDto> {
    let normalizedPhone = phoneNumber;
    try {
      normalizedPhone = this.utilService.normalizePhoneNumber(phoneNumber);
      this.logger.log(`Getting chat history for phone number: ${normalizedPhone} (original: ${phoneNumber})`);

      // Validate phone number format (basic validation)
      if (!normalizedPhone || normalizedPhone.trim().length === 0) {
        throw new HttpException(
          'Phone number is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Convert string dates to Date objects if provided
      const options = {
        ...queryDto,
        startDate: queryDto.startDate
          ? new Date(queryDto.startDate)
          : undefined,
        endDate: queryDto.endDate ? new Date(queryDto.endDate) : undefined,
      };

      // Validate date range
      if (
        options.startDate &&
        options.endDate &&
        options.startDate > options.endDate
      ) {
        throw new HttpException(
          'Start date cannot be after end date',
          HttpStatus.BAD_REQUEST,
        );
      }

      const messages = await this.chatHistoryService.getChatHistory(
        normalizedPhone,
        options,
      );

      // Calculate pagination info
      const limit = queryDto.limit || 50;
      const offset = queryDto.offset || 0;
      const hasMore = messages.length === limit;
      const page = Math.floor(offset / limit) + 1;

      const response: ChatHistoryResponseDto = {
        messages,
        total: messages.length,
        page,
        limit,
        hasMore,
      };

      this.logger.log(
        `Retrieved ${messages.length} messages for phone number: ${normalizedPhone}`,
      );

      return response;
    } catch (error) {
      this.logger.error(
        `Failed to get chat history for ${normalizedPhone}:`,
        error,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to retrieve chat history',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get delivery statistics for a specific phone number
   * Validates: Requirements 4.3
   */
  @Get('statistics/:phoneNumber')
  async getDeliveryStatistics(
    @Param('phoneNumber') phoneNumber: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<DeliveryStatsDto> {
    let normalizedPhone = phoneNumber;
    try {
      normalizedPhone = this.utilService.normalizePhoneNumber(phoneNumber);
      this.logger.log(
        `Getting delivery statistics for phone number: ${normalizedPhone} (original: ${phoneNumber})`,
      );

      // Validate phone number format
      if (!normalizedPhone || normalizedPhone.trim().length === 0) {
        throw new HttpException(
          'Phone number is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Prepare date range if provided
      let dateRange;
      if (startDate || endDate) {
        const start = startDate ? new Date(startDate) : undefined;
        const end = endDate ? new Date(endDate) : undefined;

        // Validate date range
        if (start && end && start > end) {
          throw new HttpException(
            'Start date cannot be after end date',
            HttpStatus.BAD_REQUEST,
          );
        }

        if (start || end) {
          dateRange = {
            startDate: start || new Date(0), // Default to epoch if only end date provided
            endDate: end || new Date(), // Default to now if only start date provided
          };
        }
      }

      const stats = await this.chatHistoryService.getDeliveryStatistics(
        normalizedPhone,
        dateRange,
      );

      this.logger.log(
        `Retrieved delivery statistics for phone number: ${normalizedPhone} - ${stats.totalMessages} total messages`,
      );

      return stats;
    } catch (error) {
      this.logger.error(
        `Failed to get delivery statistics for ${normalizedPhone}:`,
        error,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to retrieve delivery statistics',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Search messages with multiple filter criteria
   * Validates: Requirements 7.1, 7.2, 7.5
   */
  @Get('search')
  async searchMessages(
    @Query() searchDto: MessageSearchDto,
  ): Promise<SearchResultsDto> {
    try {
      this.logger.log('Searching messages with criteria:', searchDto);

      // Validate that at least one search criterion is provided
      const hasSearchCriteria =
        searchDto.phoneNumber ||
        searchDto.content ||
        searchDto.startDate ||
        searchDto.endDate ||
        searchDto.status ||
        searchDto.direction ||
        searchDto.messageType;

      if (!hasSearchCriteria) {
        throw new HttpException(
          'At least one search criterion must be provided',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Convert string dates to Date objects if provided
      const searchOptions = {
        ...searchDto,
        startDate: searchDto.startDate
          ? new Date(searchDto.startDate)
          : undefined,
        endDate: searchDto.endDate ? new Date(searchDto.endDate) : undefined,
      };

      // Validate date range
      if (
        searchOptions.startDate &&
        searchOptions.endDate &&
        searchOptions.startDate > searchOptions.endDate
      ) {
        throw new HttpException(
          'Start date cannot be after end date',
          HttpStatus.BAD_REQUEST,
        );
      }

      const messages =
        await this.chatHistoryService.searchMessages(searchOptions);

      // Calculate pagination info
      const limit = searchDto.limit || 50;
      const offset = searchDto.offset || 0;
      const hasMore = messages.length === limit;
      const page = Math.floor(offset / limit) + 1;

      const response: SearchResultsDto = {
        messages,
        total: messages.length,
        page,
        limit,
        hasMore,
        searchCriteria: {
          phoneNumber: searchDto.phoneNumber,
          content: searchDto.content,
          startDate: searchDto.startDate,
          endDate: searchDto.endDate,
          status: searchDto.status,
          direction: searchDto.direction,
          messageType: searchDto.messageType,
        },
      };

      this.logger.log(`Search returned ${messages.length} messages`);

      return response;
    } catch (error) {
      this.logger.error('Failed to search messages:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to search messages',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
