import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { User, UserSession, PasswordHistory } from '@prisma/client';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  async findUserById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async createUser(data: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    emailVerificationTokenHash?: string;
  }): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        emailVerificationTokenHash: data.emailVerificationTokenHash,
      },
    });
  }

  async updateUser(
    id: string,
    data: Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async incrementFailedLogin(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        failedLoginAttempts: {
          increment: 1,
        },
      },
    });
  }

  async lockAccount(id: string, lockUntil: Date): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        lockUntil,
      },
    });
  }

  async resetFailedAttempts(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        failedLoginAttempts: 0,
        lockUntil: null,
      },
    });
  }

  // Session Management
  async createSession(data: {
    userId: string;
    refreshTokenHash: string;
    deviceName: string;
    browser: string;
    operatingSystem: string;
    ipAddress: string;
  }): Promise<UserSession> {
    return this.prisma.userSession.create({
      data,
    });
  }

  async findSessionById(id: string): Promise<UserSession | null> {
    return this.prisma.userSession.findUnique({
      where: { id },
    });
  }

  async updateSessionToken(
    id: string,
    refreshTokenHash: string,
  ): Promise<UserSession> {
    return this.prisma.userSession.update({
      where: { id },
      data: {
        refreshTokenHash,
        lastUsedAt: new Date(),
      },
    });
  }

  async deleteSession(id: string): Promise<void> {
    await this.prisma.userSession.delete({
      where: { id },
    });
  }

  async deleteAllUserSessions(userId: string): Promise<void> {
    await this.prisma.userSession.deleteMany({
      where: { userId },
    });
  }

  async getUserSessions(userId: string): Promise<UserSession[]> {
    return this.prisma.userSession.findMany({
      where: { userId },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  // Password History (for prevention of password reuse)
  async getPasswordHistory(userId: string): Promise<PasswordHistory[]> {
    return this.prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5, // Enforce checking against last 5 passwords
    });
  }

  async addPasswordHistory(
    userId: string,
    passwordHash: string,
  ): Promise<PasswordHistory> {
    return this.prisma.passwordHistory.create({
      data: {
        userId,
        passwordHash,
      },
    });
  }
}
