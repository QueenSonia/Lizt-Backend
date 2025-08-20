import { UploadApiResponse } from 'cloudinary';
import { ConfigService } from '@nestjs/config';
export declare class FileUploadService {
    private readonly configService;
    constructor(configService: ConfigService);
    uploadFile(file: Express.Multer.File, folder?: string): Promise<UploadApiResponse>;
    uploadBuffer(buffer: Buffer, filename: string): Promise<UploadApiResponse>;
}
