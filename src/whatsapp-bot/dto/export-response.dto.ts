export class ExportResponseDto {
  success: boolean;
  message: string;
  exportId?: string;
  downloadUrl?: string;
  totalRecords?: number;
  estimatedCompletionTime?: string;
  isAsync?: boolean;
}
