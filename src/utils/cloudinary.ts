import { Injectable, BadRequestException } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { ConfigService } from '@nestjs/config';
import * as streamifier from 'streamifier';
import * as dotenv from 'dotenv';
dotenv.config();

@Injectable()
export class FileUploadService {
  constructor(private readonly configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get('CLOUDINARY_NAME'),
      api_key: this.configService.get('API_KEY'),
      api_secret: this.configService.get('API_SECRET'),
    });
  }

  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'properties',
  ): Promise<UploadApiResponse> {
    const allowedMimeTypes = [
      'image/png',
      'image/jpg',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'image/avif',
      'application/pdf', // ✅ Add support for PDF
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Only PNG, JPG, JPEG, WEBP, GIF, AVIF, and PDF formats are allowed',
      );
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('File size exceeds 5MB limit');
    }

    const isPdf = file.mimetype === 'application/pdf';

    return new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: isPdf ? 'raw' : 'image',
          format: isPdf ? 'pdf' : undefined,
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result as UploadApiResponse);
        },
      );

      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
  }

  async uploadBuffer(
    buffer: Buffer,
    filename: string,
  ): Promise<UploadApiResponse> {
    return new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'notices', // ✅ Stores file in 'notices' folder
          resource_type: 'raw', // ✅ Needed for non-image files like PDF
          format: 'pdf', // ✅ Ensures file format is treated as PDF
          type: 'upload', // ✅ Makes the file publicly accessible
          public_id: filename, // ✅ Optional: sets filename without extension
          use_filename: true, // ✅ Optional: helps Cloudinary keep filename
          unique_filename: false, // ✅ Optional: prevents auto-renaming
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result as UploadApiResponse);
        },
      );

      streamifier.createReadStream(buffer).pipe(uploadStream);
    });
  }

  /**
   * Delete a file from Cloudinary by public_id
   * @param publicId - The public_id of the file to delete (e.g., 'notices/offer-letter-abc123-1234567890')
   * @param resourceType - The resource type ('image', 'raw', 'video')
   */
  async deleteFile(
    publicId: string,
    resourceType: 'image' | 'raw' | 'video' = 'raw',
  ): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
      });
    } catch (error) {
      // Log error but don't throw - deletion failure shouldn't block the main operation
      console.error(
        `Failed to delete file from Cloudinary: ${publicId}`,
        error,
      );
    }
  }

  /**
   * Extract public_id from Cloudinary URL
   * @param url - Full Cloudinary URL
   * @returns public_id or null if extraction fails
   */
  extractPublicId(url: string): string | null {
    try {
      // Example URL: https://res.cloudinary.com/cloud-name/raw/upload/v1234567890/notices/offer-letter-abc123-1234567890.pdf
      const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/);
      return match ? match[1] : null;
    } catch (error) {
      console.error('Failed to extract public_id from URL:', url, error);
      return null;
    }
  }
}
