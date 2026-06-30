import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';
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

  @ApiProperty({ example: 12.50 })
  @IsNumber()
  @Min(0.50, { message: 'Minimum checkout price is $0.50' })
  amount!: number;
}
