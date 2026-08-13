import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TicketStatus, TicketPriority } from '@prisma/client';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(private readonly prisma: PrismaService) {}

  private generateTicketRef(): string {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `UU-${dateStr}-${rand}`;
  }

  async createTicket(
    userId: string | undefined,
    email: string,
    subject: string,
    message: string,
    category: string = 'general',
  ) {
    const ticketRef = this.generateTicketRef();

    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId: userId || null,
        email,
        subject,
        message,
        category,
        ticketRef,
        status: TicketStatus.OPEN,
        priority: TicketPriority.MEDIUM,
      },
    });

    this.logger.log(`[Support] Ticket created: ${ticketRef} by ${email}`);

    return ticket;
  }

  async getTicketsByUserId(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { replies: true } },
      },
    });
  }

  async getTicketById(ticketId: string, userId?: string) {
    const where: any = { id: ticketId };
    if (userId) {
      where.userId = userId;
    }

    const ticket = await this.prisma.supportTicket.findFirst({
      where,
      include: {
        replies: {
          orderBy: { createdAt: 'asc' },
        },
        user: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    return ticket;
  }

  async addReply(
    ticketId: string,
    message: string,
    isStaff: boolean,
    senderName: string,
    userId?: string,
  ) {
    // Verify ticket exists and belongs to user (if userId provided)
    const where: any = { id: ticketId };
    if (userId && !isStaff) {
      where.userId = userId;
    }

    const ticket = await this.prisma.supportTicket.findFirst({ where });
    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    const reply = await this.prisma.ticketReply.create({
      data: {
        ticketId,
        message,
        isStaff,
        senderName,
      },
    });

    // If staff replies, move ticket to IN_PROGRESS if it was OPEN
    if (isStaff && ticket.status === TicketStatus.OPEN) {
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: TicketStatus.IN_PROGRESS },
      });
    }

    this.logger.log(
      `[Support] Reply added to ticket ${ticket.ticketRef} by ${isStaff ? 'staff' : 'user'}: ${senderName}`,
    );

    return reply;
  }

  async getAllTickets(
    status?: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const where: any = {};
    if (status) {
      where.status = status as TicketStatus;
    }

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: {
            select: { firstName: true, lastName: true, email: true },
          },
          _count: { select: { replies: true } },
        },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return {
      tickets,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateTicketStatus(
    ticketId: string,
    status: string,
    priority?: string,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException('Support ticket not found');
    }

    const updateData: any = { status: status as TicketStatus };
    if (priority) {
      updateData.priority = priority as TicketPriority;
    }

    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: updateData,
    });

    this.logger.log(
      `[Support] Ticket ${ticket.ticketRef} status updated to ${status}`,
    );

    return updated;
  }
}
