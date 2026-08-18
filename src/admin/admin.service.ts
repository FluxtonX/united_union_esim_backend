import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Role, OrderStatus, TicketStatus } from '@prisma/client';
import { PasswordUtility } from '../auth/utils/password.utility';
import { PaymentService } from '../payment/payment.service';
import { CreateModeratorDto } from './dto/create-moderator.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
  ) {}

  /**
   * Get main dashboard metrics & Yesim balance
   */
  async getDashboardStats() {
    const [
      totalUsers,
      totalModerators,
      activeEsims,
      totalOrders,
      revenueResult,
      openTicketsCount,
      recentOrders,
      recentTickets,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: Role.USER } }),
      this.prisma.user.count({ where: { role: { in: [Role.ADMIN, Role.SUPERADMIN] } } }),
      this.prisma.esimProfile.count({ where: { status: 'active' } }),
      this.prisma.esimOrder.count(),
      this.prisma.esimOrder.aggregate({
        _sum: { amountPaid: true },
        where: { status: OrderStatus.PROVISIONED },
      }),
      this.prisma.supportTicket.count({
        where: { status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS] } },
      }),
      this.prisma.esimOrder.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.supportTicket.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    let yesimBalance: any = null;
    try {
      yesimBalance = await this.paymentService.getYesimBalance();
    } catch {
      yesimBalance = { balance: 'N/A', currency: 'EUR' };
    }

    return {
      totalUsers,
      totalModerators,
      activeEsims,
      totalOrders,
      totalRevenue: revenueResult._sum.amountPaid || 0,
      openTicketsCount,
      yesimBalance,
      recentOrders,
      recentTickets,
    };
  }

  /**
   * Get paginated users
   */
  async getUsers(search?: string, role?: Role, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (role) {
      where.role = role;
    }
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          emailVerified: true,
          failedLoginAttempts: true,
          lockUntil: true,
          lastLogin: true,
          createdAt: true,
          _count: {
            select: {
              orders: true,
              esimProfiles: true,
              tickets: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get single user with details
   */
  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        emailVerified: true,
        failedLoginAttempts: true,
        lockUntil: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true,
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        esimProfiles: {
          orderBy: { createdAt: 'desc' },
        },
        tickets: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        sessions: {
          orderBy: { lastUsedAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  /**
   * Lock or unlock user account
   */
  async updateUserStatus(userId: string, isLocked: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const lockUntil = isLocked ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) : null;
    const failedLoginAttempts = isLocked ? 5 : 0;

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        lockUntil,
        failedLoginAttempts,
      },
      select: {
        id: true,
        email: true,
        lockUntil: true,
        failedLoginAttempts: true,
      },
    });
  }

  /**
   * Update user role (SUPERADMIN only)
   */
  async updateUserRole(userId: string, targetRole: Role) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { role: targetRole },
      select: { id: true, email: true, role: true },
    });
  }

  /**
   * Get all moderators / staff
   */
  async getModerators() {
    return this.prisma.user.findMany({
      where: {
        role: { in: [Role.ADMIN, Role.SUPERADMIN] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        lastLogin: true,
        createdAt: true,
      },
    });
  }

  /**
   * Create a new moderator / staff account (SUPERADMIN only)
   */
  async createModerator(dto: CreateModeratorDto) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('User with this email already exists');
    }

    const passwordHash = await PasswordUtility.hash(dto.password);
    const role = dto.role || Role.ADMIN;

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        emailVerified: true,
        role,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
      },
    });

    return user;
  }

  /**
   * Get paginated eSIM profiles
   */
  async getEsimProfiles(search?: string, status?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) {
      where.status = status;
    }
    if (search) {
      where.OR = [
        { iccid: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [esims, total] = await Promise.all([
      this.prisma.esimProfile.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.esimProfile.count({ where }),
    ]);

    const formattedEsims = esims.map((item) => ({
      ...item,
      dataTotalBytes: item.dataTotalBytes.toString(),
      dataUsedBytes: item.dataUsedBytes.toString(),
      dataRemainingBytes: item.dataRemainingBytes.toString(),
    }));

    return {
      items: formattedEsims,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get paginated eSIM orders
   */
  async getOrders(status?: OrderStatus, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) {
      where.status = status;
    }

    const [orders, total] = await Promise.all([
      this.prisma.esimOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          esimProfile: {
            select: { iccid: true, status: true },
          },
        },
      }),
      this.prisma.esimOrder.count({ where }),
    ]);

    return {
      items: orders,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
