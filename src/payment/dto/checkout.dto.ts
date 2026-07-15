import { IsString, IsNotEmpty, IsNumber, Min, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CheckoutDto {
  @ApiProperty({ example: 'maya_us_5gb_30d' })
  @IsString()
  @IsNotEmpty()
  planId!: string;

  @ApiProperty({ example: 'US' })
  @IsString()
  @IsNotEmpty()
  countryCode!: string;

  @ApiProperty({ example: 12.5 })
  @IsNumber()
  @Min(0.5, { message: 'Minimum checkout price is $0.50' })
  amount!: number;

  @ApiProperty({ example: '8937204017...', required: false })
  @IsString()
  @IsOptional()
  iccid?: string;
}
