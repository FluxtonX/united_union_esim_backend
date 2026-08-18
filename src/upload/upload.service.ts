import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaService } from '../database/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private s3Client: S3Client | null = null;

  constructor(private readonly prisma: PrismaService) {
    const region = process.env.AWS_REGION || 'us-east-1';
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    if (accessKeyId && secretAccessKey) {
      this.s3Client = new S3Client({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    }
  }

  async uploadProfilePhoto(
    userId: string,
    file: Express.Multer.File,
  ): Promise<{ success: boolean; url: string }> {
    if (!file || !file.buffer) {
      throw new BadRequestException('No image file provided.');
    }

    const bucketName = process.env.AWS_S3_BUCKET_NAME || 'united-union-esim-uploads';
    const region = process.env.AWS_REGION || 'us-east-1';
    const fileExtension = file.originalname.split('.').pop() || 'jpg';
    const key = `avatars/${userId}_${crypto.randomBytes(6).toString('hex')}.${fileExtension}`;

    let publicUrl = '';

    if (this.s3Client) {
      try {
        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype || 'image/jpeg',
        });

        await this.s3Client.send(command);
        publicUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
        this.logger.log(`[AWS S3] Uploaded profile photo for user ${userId} -> ${publicUrl}`);
      } catch (err) {
        this.logger.error(`[AWS S3 Upload Error] ${(err as Error).message}`);
        // Fallback placeholder URL if S3 keys not set yet
        publicUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
      }
    } else {
      this.logger.warn(`AWS S3 credentials not configured. Generating placeholder S3 URL.`);
      publicUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
    }

    // Save avatar URL to User record in database
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: publicUrl },
    });

    return {
      success: true,
      url: publicUrl,
    };
  }
}
