import { Controller, Get, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { CatalogService, CountryListItem } from './catalog.service';
import { ProviderPlan } from '../providers/interfaces/esim-provider.interface';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';

@ApiTags('Catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('countries')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List supported countries with plan count and starting price',
  })
  @ApiResponse({
    status: 200,
    description: 'List of countries retrieved successfully.',
  })
  async getCountries(): Promise<{ success: boolean; data: CountryListItem[] }> {
    const countries = await this.catalogService.getCountries();
    return {
      success: true,
      data: countries,
    };
  }

  @Get('plans')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List available eSIM plans for a specific country' })
  @ApiQuery({
    name: 'country',
    description: 'ISO 2-letter country code (e.g. US, GB)',
    required: true,
  })
  @ApiResponse({ status: 200, description: 'Plans retrieved successfully.' })
  async getPlans(
    @Query('country') countryCode: string,
  ): Promise<{ success: boolean; data: ProviderPlan[] }> {
    const plans = await this.catalogService.getPlans(countryCode);
    return {
      success: true,
      data: plans,
    };
  }
}
