import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTicketDto {
  @ApiProperty({ example: 'eSIM Activation Help' })
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty({ example: 'My eSIM is not connecting after installation.' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({ example: 'technical', enum: ['general', 'billing', 'activation', 'technical'] })
  @IsString()
  @IsOptional()
  @IsIn(['general', 'billing', 'activation', 'technical'])
  category?: string;

  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsString()
  @IsOptional()
  email?: string;
}

export class ReplyTicketDto {
  @ApiProperty({ example: 'Thank you, I will try that.' })
  @IsString()
  @IsNotEmpty()
  message: string;
}

export class UpdateTicketStatusDto {
  @ApiProperty({ example: 'IN_PROGRESS', enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] })
  @IsString()
  @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'])
  status: string;

  @ApiPropertyOptional({ example: 'HIGH', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] })
  @IsString()
  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: string;
}
