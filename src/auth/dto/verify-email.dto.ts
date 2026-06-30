import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({ example: 'a1b2c3d4e5f6g7h8' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
