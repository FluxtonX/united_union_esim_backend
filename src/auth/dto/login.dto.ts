import { IsEmail, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'Invalid email address' })
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'Password123!@#' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
