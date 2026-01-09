import { ChatLog } from '../entities/chat-log.entity';
import { MessageStatus } from '../entities/message-status.enum';

export interface ChatLogResponse {
  id: string;
  phone_number: string;
  direction: string;
  message_type: string;
  content: string;
  metadata: Record<string, any>;
  whatsapp_message_id?: string;
  status: string; // Lowercase status for frontend compatibility
  error_code?: string;
  error_reason?: string;
  created_at: Date;
  timestamp: string; // Formatted timestamp for frontend
}

export class ChatHistoryResponseDto {
  messages: ChatLogResponse[];
  total: number;
  page?: number;
  limit?: number;
  hasMore: boolean;

  static fromChatLogs(
    chatLogs: ChatLog[],
    total?: number,
    page?: number,
    limit?: number,
    hasMore?: boolean,
  ): ChatHistoryResponseDto {
    const messages: ChatLogResponse[] = chatLogs.map((log) => ({
      id: log.id,
      phone_number: log.phone_number,
      direction: log.direction,
      message_type: log.message_type,
      content: log.content,
      metadata: log.metadata || {},
      whatsapp_message_id: log.whatsapp_message_id,
      status: log.status.toLowerCase(), // Convert to lowercase for frontend
      error_code: log.error_code,
      error_reason: log.error_reason,
      created_at: log.created_at,
      timestamp: log.created_at.toISOString(), // Add formatted timestamp
    }));

    return {
      messages,
      total: total ?? messages.length,
      page,
      limit,
      hasMore: hasMore ?? false,
    };
  }
}
