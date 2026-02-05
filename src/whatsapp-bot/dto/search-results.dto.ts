import { ChatLog } from '../entities/chat-log.entity';

export class SearchResultsDto {
  messages: ChatLog[];
  total: number;
  page?: number;
  limit?: number;
  hasMore: boolean;
  searchCriteria: {
    phoneNumber?: string;
    content?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    direction?: string;
    messageType?: string;
  };
}
