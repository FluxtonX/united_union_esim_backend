import { IsEmail, IsString, MinLength, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class CreateModeratorDto {
  @ApiProperty({ example: 'support@unitedunion.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SecurePassword123!' })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: 'Alex' })
  @IsString()
  firstName!: string;

  @ApiProperty({ example: 'Morgan' })
  @IsString()
  lastName!: string;

  @ApiPropertyOptional({ enum: Role, default: Role.ADMIN })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
