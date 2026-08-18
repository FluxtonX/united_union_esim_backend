import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role, OrderStatus } from '@prisma/client';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('Admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard/stats')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Get dashboard metrics, counts & Yesim balance' })
  @ApiResponse({ status: 200, description: 'Dashboard metrics retrieved successfully.' })
  async getDashboardStats(): Promise<{ success: boolean; data: any }> {
    const stats = await this.adminService.getDashboardStats();
    return { success: true, data: stats };
  }

  @Get('users')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Get paginated users with search & filters' })
  @ApiResponse({ status: 200, description: 'User list retrieved.' })
  async getUsers(
    @Query('search') search?: string,
    @Query('role') role?: Role,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{ success: boolean; data: any }> {
    const result = await this.adminService.getUsers(
      search,
      role,
      parseInt(page || '1', 10),
      parseInt(limit || '20', 10),
    );
    return { success: true, data: result };
  }

  @Get('users/:id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Get user details, orders, eSIM profiles & tickets' })
  @ApiResponse({ status: 200, description: 'User details retrieved.' })
  async getUserDetail(
    @Param('id') userId: string,
  ): Promise<{ success: boolean; data: any }> {
    const user = await this.adminService.getUserDetail(userId);
    return { success: true, data: user };
  }

  @Patch('users/:id/status')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Lock or unlock user account' })
  @ApiResponse({ status: 200, description: 'User account status updated.' })
  async updateUserStatus(
    @Param('id') userId: string,
    @Body('isLocked') isLocked: boolean,
  ): Promise<{ success: boolean; data: any }> {
    const result = await this.adminService.updateUserStatus(userId, isLocked);
    return { success: true, data: result };
  }

  @Patch('users/:id/role')
  @Roles(Role.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SuperAdmin: Change user role' })
  @ApiResponse({ status: 200, description: 'User role updated.' })
  async updateUserRole(
    @Param('id') userId: string,
    @Body('role') role: Role,
  ): Promise<{ success: boolean; data: any }> {
    const result = await this.adminService.updateUserRole(userId, role);
    return { success: true, data: result };
  }

  @Get('moderators')
  @Roles(Role.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SuperAdmin: List all staff & moderators' })
  @ApiResponse({ status: 200, description: 'Moderators retrieved.' })
  async getModerators(): Promise<{ success: boolean; data: any[] }> {
    const moderators = await this.adminService.getModerators();
    return { success: true, data: moderators };
  }

  @Post('moderators')
  @Roles(Role.SUPERADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'SuperAdmin: Create a new moderator / support account' })
  @ApiResponse({ status: 201, description: 'Moderator account created.' })
  async createModerator(
    @Body() dto: CreateModeratorDto,
  ): Promise<{ success: boolean; data: any }> {
    const moderator = await this.adminService.createModerator(dto);
    return { success: true, data: moderator };
  }

  @Get('esims')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Get paginated eSIM profiles' })
  @ApiResponse({ status: 200, description: 'eSIM profiles retrieved.' })
  async getEsimProfiles(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{ success: boolean; data: any }> {
    const result = await this.adminService.getEsimProfiles(
      search,
      status,
      parseInt(page || '1', 10),
      parseInt(limit || '20', 10),
    );
    return { success: true, data: result };
  }

  @Get('orders')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Get paginated eSIM purchase orders' })
  @ApiResponse({ status: 200, description: 'eSIM orders retrieved.' })
  async getOrders(
    @Query('status') status?: OrderStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{ success: boolean; data: any }> {
    const result = await this.adminService.getOrders(
      status,
      parseInt(page || '1', 10),
      parseInt(limit || '20', 10),
    );
    return { success: true, data: result };
  }
}
