import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { ApiTags, ApiOperation, ApiConsumes, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';

@ApiTags('File Uploads')
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('profile-photo')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload user profile photo to AWS S3' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, description: 'Profile photo uploaded successfully.' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadProfilePhoto(
    @GetUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ success: boolean; url: string }> {
    if (!file) {
      throw new BadRequestException('Image file is required.');
    }
    return await this.uploadService.uploadProfilePhoto(userId, file);
  }
}
