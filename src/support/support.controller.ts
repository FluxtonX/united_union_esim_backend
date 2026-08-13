import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SupportService } from './support.service';
import {
  CreateTicketDto,
  ReplyTicketDto,
  UpdateTicketStatusDto,
} from './dto/support.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Role } from '@prisma/client';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('Support')
@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('ticket')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new support ticket' })
  @ApiResponse({ status: 201, description: 'Ticket created successfully.' })
  async createTicket(
    @GetUser('id') userId: string,
    @GetUser('email') email: string,
    @Body() dto: CreateTicketDto,
  ): Promise<{ success: boolean; data: any }> {
    const ticket = await this.supportService.createTicket(
      userId,
      dto.email || email,
      dto.subject,
      dto.message,
      dto.category,
    );
    return { success: true, data: ticket };
  }

  @Get('tickets')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user\'s support tickets' })
  @ApiResponse({ status: 200, description: 'Tickets retrieved successfully.' })
  async getMyTickets(
    @GetUser('id') userId: string,
  ): Promise<{ success: boolean; data: any[] }> {
    const tickets = await this.supportService.getTicketsByUserId(userId);
    return { success: true, data: tickets };
  }

  @Get('tickets/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single ticket with replies' })
  @ApiResponse({ status: 200, description: 'Ticket detail retrieved successfully.' })
  async getTicket(
    @GetUser('id') userId: string,
    @Param('id') ticketId: string,
  ): Promise<{ success: boolean; data: any }> {
    const ticket = await this.supportService.getTicketById(ticketId, userId);
    return { success: true, data: ticket };
  }

  @Post('tickets/:id/reply')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a reply to a support ticket' })
  @ApiResponse({ status: 201, description: 'Reply added successfully.' })
  async addReply(
    @GetUser('id') userId: string,
    @GetUser() user: any,
    @Param('id') ticketId: string,
    @Body() dto: ReplyTicketDto,
  ): Promise<{ success: boolean; data: any }> {
    const senderName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User';
    const reply = await this.supportService.addReply(
      ticketId,
      dto.message,
      false,
      senderName,
      userId,
    );
    return { success: true, data: reply };
  }

  // ─── Admin Endpoints ────────────────────────────────────────────────

  @Get('admin/tickets')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: Get all support tickets (paginated)' })
  @ApiResponse({ status: 200, description: 'All tickets retrieved.' })
  async getAllTickets(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{ success: boolean; data: any }> {
    const result = await this.supportService.getAllTickets(
      status,
      parseInt(page || '1', 10),
      parseInt(limit || '20', 10),
    );
    return { success: true, data: result };
  }

  @Patch('admin/tickets/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: Update ticket status and priority' })
  @ApiResponse({ status: 200, description: 'Ticket updated successfully.' })
  async updateTicketStatus(
    @Param('id') ticketId: string,
    @Body() dto: UpdateTicketStatusDto,
  ): Promise<{ success: boolean; data: any }> {
    const ticket = await this.supportService.updateTicketStatus(
      ticketId,
      dto.status,
      dto.priority,
    );
    return { success: true, data: ticket };
  }

  @Post('admin/tickets/:id/reply')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: Reply to a support ticket' })
  @ApiResponse({ status: 201, description: 'Admin reply added.' })
  async adminReply(
    @GetUser() user: any,
    @Param('id') ticketId: string,
    @Body() dto: ReplyTicketDto,
  ): Promise<{ success: boolean; data: any }> {
    const senderName = 'Support Team';
    const reply = await this.supportService.addReply(
      ticketId,
      dto.message,
      true,
      senderName,
    );
    return { success: true, data: reply };
  }
}
