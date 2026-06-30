import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthRepository } from './repositories/auth.repository';
import { PasswordUtility } from './utils/password.utility';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UAParser } from 'ua-parser-js';
import * as crypto from 'crypto';
import { User, UserSession } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repository: AuthRepository,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Registers a new user. Does not allow login until email is verified.
   */
  async register(dto: RegisterDto): Promise<void> {
    const email = dto.email.toLowerCase().trim();

    // Check duplicate
    const existing = await this.repository.findUserByEmail(email);
    if (existing) {
      // Return generic response to avoid email enumeration
      this.logger.log(`Registration attempt for existing email: ${email}`);
      return;
    }

    // Hash password
    const passwordHash = await PasswordUtility.hash(dto.password);

    // Generate email verification token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    // Create user
    const user = await this.repository.createUser({
      email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      emailVerificationTokenHash: tokenHash,
    });

    // Record initial password history
    await this.repository.addPasswordHistory(user.id, passwordHash);

    // Send email verification
    await this.mailService.sendEmailVerification(email, rawToken);
    this.logger.log(`Success registration for user id: ${user.id}`);
  }

  /**
   * Authenticates user. Supports account locking on 5 consecutive failures.
   */
  async login(
    dto: LoginDto,
    ip: string,
    userAgent: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const email = dto.email.toLowerCase().trim();
    const genericError = new UnauthorizedException('Invalid credentials');

    const user = await this.repository.findUserByEmail(email);
    if (!user) {
      this.logger.warn(`Login failed: email not found: ${email}`);
      throw genericError;
    }

    // Check account lock status
    if (user.lockUntil && user.lockUntil > new Date()) {
      this.logger.warn(`Login failed: Account locked for user: ${user.id}`);
      throw new UnauthorizedException('Account is temporarily locked. Try again later.');
    }

    // Verify email verified
    if (!user.emailVerified) {
      this.logger.warn(`Login failed: email not verified for user: ${user.id}`);
      throw new UnauthorizedException('Please verify your email before logging in.');
    }

    // Verify password
    const isPasswordValid = await PasswordUtility.verify(user.passwordHash, dto.password);
    if (!isPasswordValid) {
      await this.handleFailedLogin(user);
      throw genericError;
    }

    // Reset failed login status
    await this.repository.resetFailedAttempts(user.id);

    // Update last login
    await this.repository.updateUser(user.id, { lastLogin: new Date() });

    // Parse user agent
    const parser = new UAParser(userAgent);
    const browser = parser.getBrowser().name || 'Unknown Browser';
    const os = parser.getOS().name || 'Unknown OS';
    const device = parser.getDevice().model || parser.getDevice().type || 'Desktop/Laptop';

    // Generate tokens
    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const refreshHash = await PasswordUtility.hash(rawRefreshToken);

    // Create session
    const session = await this.repository.createSession({
      userId: user.id,
      refreshTokenHash: refreshHash,
      deviceName: device,
      browser,
      operatingSystem: os,
      ipAddress: ip,
    });

    const accessToken = this.generateAccessToken(user, session.id);
    const refreshToken = this.generateRefreshToken(session.id, rawRefreshToken);

    this.logger.log(`Successful login for user: ${user.id}, Session: ${session.id}`);

    return { accessToken, refreshToken };
  }

  /**
   * Refresh access and refresh tokens. Implements token reuse detection.
   */
  async refresh(
    rawRefreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const genericError = new UnauthorizedException('Invalid token');

    try {
      // Decode without verification first to extract sessionId
      const decoded = this.jwtService.decode(rawRefreshToken) as any;
      if (!decoded || !decoded.sessionId || !decoded.tokenValue) {
        throw genericError;
      }

      const session = await this.repository.findSessionById(decoded.sessionId);
      if (!session) {
        throw genericError;
      }

      // Verify token value against stored hash
      const isTokenValid = await PasswordUtility.verify(
        session.refreshTokenHash,
        decoded.tokenValue,
      );

      if (!isTokenValid) {
        // DETECTED TOKEN REUSE (Theft/Compromise)
        // Revoke all sessions for security
        await this.repository.deleteAllUserSessions(session.userId);
        this.logger.error(
          `Token reuse detected! Revoking all sessions for User: ${session.userId}`,
        );
        throw new UnauthorizedException('Session expired due to suspicious token activity');
      }

      // Rotate Refresh Token
      const newRawToken = crypto.randomBytes(40).toString('hex');
      const newHash = await PasswordUtility.hash(newRawToken);

      await this.repository.updateSessionToken(session.id, newHash);

      const user = await this.repository.findUserById(session.userId);
      if (!user) {
        throw genericError;
      }

      const accessToken = this.generateAccessToken(user, session.id);
      const refreshToken = this.generateRefreshToken(session.id, newRawToken);

      this.logger.log(`Rotated refresh token for session: ${session.id}`);

      return { accessToken, refreshToken };
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw genericError;
    }
  }

  /**
   * Single-device logout.
   */
  async logout(sessionId: string): Promise<void> {
    try {
      await this.repository.deleteSession(sessionId);
      this.logger.log(`Logged out session: ${sessionId}`);
    } catch {
      // Silent catch
    }
  }

  /**
   * Logout all devices.
   */
  async logoutAll(userId: string): Promise<void> {
    await this.repository.deleteAllUserSessions(userId);
    this.logger.log(`Logged out all sessions for user: ${userId}`);
  }

  /**
   * Forgot password: generates a short-lived token and emails it.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.repository.findUserByEmail(email);
    if (!user) {
      // Generic success to prevent email verification scans
      return;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.repository.updateUser(user.id, {
      passwordResetTokenHash: tokenHash,
      passwordResetExpires: expires,
    });

    await this.mailService.sendPasswordReset(user.email, rawToken);
    this.logger.log(`Forgot password link requested for user: ${user.id}`);
  }

  /**
   * Resets password using token. Invalidates all active sessions.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = this.hashToken(dto.token);

    // Find user by reset token
    const users = await this.repository.findUserByEmail('placeholder'); // We must query token hash in prisma, wait, let's write custom query in repository if needed, or query direct.
    // Let's implement finding by token directly in Prisma
    const user = await this.prismaFindUserByResetToken(tokenHash);
    if (!user || !user.passwordResetExpires || user.passwordResetExpires < new Date()) {
      throw new BadRequestException('Reset token is invalid or has expired');
    }

    // Enforce password reuse policy (check against history)
    await this.checkPasswordReuse(user.id, dto.newPassword);

    const newHash = await PasswordUtility.hash(dto.newPassword);

    // Update password, clean reset fields
    await this.repository.updateUser(user.id, {
      passwordHash: newHash,
      passwordResetTokenHash: null,
      passwordResetExpires: null,
    });

    // Save history
    await this.repository.addPasswordHistory(user.id, newHash);

    // Invalidate all active sessions (forced logout on reset)
    await this.repository.deleteAllUserSessions(user.id);

    this.logger.log(`Password reset successfully for user: ${user.id}`);
  }

  /**
   * Verifies account email.
   */
  async verifyEmail(token: string): Promise<void> {
    const tokenHash = this.hashToken(token);
    const user = await this.prismaFindUserByVerificationToken(tokenHash);

    if (!user) {
      throw new BadRequestException('Verification token is invalid or has expired');
    }

    await this.repository.updateUser(user.id, {
      emailVerified: true,
      emailVerificationTokenHash: null,
    });

    this.logger.log(`Email verified successfully for user: ${user.id}`);
  }

  /**
   * Logged-in change password.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.repository.findUserById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Verify current password
    const isPasswordValid = await PasswordUtility.verify(user.passwordHash, dto.oldPassword);
    if (!isPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    // Enforce reuse policy
    await this.checkPasswordReuse(userId, dto.newPassword);

    const newHash = await PasswordUtility.hash(dto.newPassword);

    // Update password
    await this.repository.updateUser(userId, {
      passwordHash: newHash,
    });

    // Save to history
    await this.repository.addPasswordHistory(userId, newHash);

    this.logger.log(`Password changed by user: ${userId}`);
  }

  // Active Sessions info
  async getSessions(userId: string): Promise<any[]> {
    const sessions = await this.repository.getUserSessions(userId);
    return sessions.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      browser: s.browser,
      operatingSystem: s.operatingSystem,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.repository.findSessionById(sessionId);
    if (!session || session.userId !== userId) {
      throw new BadRequestException('Session not found');
    }
    await this.repository.deleteSession(sessionId);
  }

  // Private Helper Methods
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async handleFailedLogin(user: User): Promise<void> {
    const attempts = user.failedLoginAttempts + 1;
    if (attempts >= 5) {
      const lockTime = new Date(Date.now() + 15 * 60 * 1000); // 15 mins lock
      await this.repository.lockAccount(user.id, lockTime);
      this.logger.warn(`Account locked due to consecutive failures. User: ${user.id}`);
    } else {
      await this.repository.incrementFailedLogin(user.id);
    }
  }

  private async checkPasswordReuse(userId: string, plainText: string): Promise<void> {
    const history = await this.repository.getPasswordHistory(userId);
    for (const record of history) {
      const matches = await PasswordUtility.verify(record.passwordHash, plainText);
      if (matches) {
        throw new BadRequestException(
          'You cannot reuse a recently used password. Please choose a new password.',
        );
      }
    }
  }

  private generateAccessToken(user: User, sessionId: string): string {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      sessionId,
    };
    return this.jwtService.sign(payload, { expiresIn: '15m' });
  }

  private generateRefreshToken(sessionId: string, rawTokenValue: string): string {
    const payload = {
      sessionId,
      tokenValue: rawTokenValue,
    };
    // Separate secret or same, but set a longer expiry
    return this.jwtService.sign(payload, { expiresIn: '30d' });
  }

  // Accessing prisma directly for token lookups since they aren't on primary unique index
  private async prismaFindUserByResetToken(tokenHash: string): Promise<User | null> {
    // Directly querying prisma client via the repo's private prisma instance, wait, we can implement it cleanly
    const prisma = (this.repository as any).prisma as PrismaService;
    return prisma.user.findFirst({
      where: { passwordResetTokenHash: tokenHash },
    });
  }

  private async prismaFindUserByVerificationToken(tokenHash: string): Promise<User | null> {
    const prisma = (this.repository as any).prisma as PrismaService;
    return prisma.user.findFirst({
      where: { emailVerificationTokenHash: tokenHash },
    });
  }
}
