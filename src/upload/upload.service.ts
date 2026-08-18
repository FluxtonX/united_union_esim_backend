import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaService } from '../database/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(private readonly prisma: PrismaService) {}

  private getS3Client(): { s3: S3Client; bucketName: string; region: string } {
    const region = process.env.AWS_REGION || 'us-east-1';
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const bucketName = process.env.AWS_S3_BUCKET_NAME || 'united-union-esim-uploads';

    if (!accessKeyId || !secretAccessKey) {
      this.logger.error('AWS S3 credentials (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) are missing in environment variables.');
      throw new BadRequestException(
        'AWS S3 is not configured. Please add AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to environment variables.',
      );
    }

    const s3 = new S3Client({
      region,
      credentials: {
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim(),
      },
    });

    return { s3, bucketName, region };
  }

  async uploadProfilePhoto(
    userId: string,
    file: Express.Multer.File,
  ): Promise<{ success: boolean; url: string }> {
    if (!file || !file.buffer) {
      throw new BadRequestException('No image file provided.');
    }

    const { s3, bucketName, region } = this.getS3Client();

    const fileExtension = file.originalname.split('.').pop() || 'jpg';
    const key = `avatars/${userId}_${crypto.randomBytes(6).toString('hex')}.${fileExtension}`;

    try {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype || 'image/jpeg',
      });

      await s3.send(command);
      const publicUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
      this.logger.log(`[AWS S3] Uploaded profile photo successfully for user ${userId} -> ${publicUrl}`);

      // Save avatar URL to User record in PostgreSQL database
      await this.prisma.user.update({
        where: { id: userId },
        data: { avatarUrl: publicUrl },
      });

      return {
        success: true,
        url: publicUrl,
      };
    } catch (err: any) {
      this.logger.error(`[AWS S3 Upload Error] ${err.name}: ${err.message}`);
      throw new BadRequestException(`AWS S3 Upload failed: ${err.message || 'Check AWS S3 bucket and IAM permissions'}`);
    }
  }
}
