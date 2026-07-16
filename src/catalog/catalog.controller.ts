import { Controller, Get, Post, Query, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
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
  async getCountries(
    @Query('currency') currency?: string,
  ): Promise<{ success: boolean; data: CountryListItem[] }> {
    const countries = await this.catalogService.getCountries(currency);
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
  @ApiQuery({
    name: 'currency',
    description: 'Preferred display currency (USD, EUR)',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Plans retrieved successfully.' })
  async getPlans(
    @Query('country') countryCode: string,
    @Query('currency') currency?: string,
  ): Promise<{ success: boolean; data: ProviderPlan[] }> {
    const plans = await this.catalogService.getPlans(countryCode, currency);
    return {
      success: true,
      data: plans,
    };
  }

  @Get('devices')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all eSIM compatible devices grouped by brand' })
  @ApiResponse({ status: 200, description: 'Compatible devices retrieved successfully.' })
  async getDevices(): Promise<{ success: boolean; data: any }> {
    const devices = await this.catalogService.getDevicesGrouped();
    return {
      success: true,
      data: devices,
    };
  }

  @Get('devices/check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check if a specific device brand and model supports eSIM' })
  @ApiQuery({ name: 'brand', description: 'Device brand (e.g. Apple, Samsung)', required: true })
  @ApiQuery({ name: 'model', description: 'Device model (e.g. iPhone 15, Galaxy S23)', required: true })
  @ApiResponse({ status: 200, description: 'Compatibility check completed.' })
  async checkDevice(
    @Query('brand') brand: string,
    @Query('model') model: string,
  ): Promise<{ success: boolean; compatible: boolean }> {
    if (!brand || !model) {
      throw new BadRequestException('Both brand and model query parameters are required.');
    }
    const compatible = await this.catalogService.checkDeviceCompatibility(brand, model);
    return {
      success: true,
      compatible,
    };
  }

  @Post('devices/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually sync supported devices database from Yesim' })
  @ApiResponse({ status: 200, description: 'Devices synced successfully.' })
  async syncDevices(): Promise<{ success: boolean; syncedCount: number }> {
    const syncedCount = await this.catalogService.syncSupportedDevices();
    return {
      success: true,
      syncedCount,
    };
  }
}
