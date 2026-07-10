import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  Get,
  Delete,
  Param,
  Patch,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GetUser } from './decorators/get-user.decorator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register a new traveler' })
  @ApiResponse({
    status: 200,
    description: 'Registration successful. Verification email sent.',
  })
  async register(@Body() dto: RegisterDto): Promise<{
    success: boolean;
    message: string;
    verificationToken?: string;
  }> {
    const result = await this.authService.register(dto);
    return {
      success: true,
      message:
        'Registration successful. Please verify your email before logging in.',
      verificationToken: result.verificationToken,
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({
    status: 200,
    description: 'Login successful. Tokens set in secure cookies.',
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ): Promise<{ success: boolean; message: string }> {
    const ip = req.ip || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown';

    const { accessToken, refreshToken } = await this.authService.login(
      dto,
      ip,
      userAgent,
    );

    // Set secure HTTP-Only cookies
    this.setTokenCookies(res, accessToken, refreshToken);

    return {
      success: true,
      message: 'Logged in successfully',
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate JWT access and refresh tokens' })
  @ApiResponse({ status: 200, description: 'Tokens rotated successfully.' })
  async refresh(
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ): Promise<{ success: boolean; message: string }> {
    // Extract token from cookies first, fallback to request body/headers if needed
    const oldRefreshToken =
      req.cookies?.refresh_token || req.body?.refreshToken;

    const { accessToken, refreshToken } =
      await this.authService.refresh(oldRefreshToken);

    this.setTokenCookies(res, accessToken, refreshToken);

    return {
      success: true,
      message: 'Tokens rotated successfully',
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout current device session' })
  async logout(
    @GetUser('sessionId') sessionId: string,
    @Res({ passthrough: true }) res: any,
  ): Promise<{ success: boolean; message: string }> {
    await this.authService.logout(sessionId);
    this.clearTokenCookies(res);
    return {
      success: true,
      message: 'Logged out successfully',
    };
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout all device sessions' })
  async logoutAll(
    @GetUser('id') userId: string,
    @Res({ passthrough: true }) res: any,
  ): Promise<{ success: boolean; message: string }> {
    await this.authService.logoutAll(userId);
    this.clearTokenCookies(res);
    return {
      success: true,
      message: 'Logged out of all devices successfully',
    };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset token link' })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.authService.forgotPassword(dto.email);
    return {
      success: true,
      message: 'If the email exists, a password reset link has been sent.',
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token' })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.authService.resetPassword(dto);
    return {
      success: true,
      message: 'Password reset successfully',
    };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email verification token' })
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.authService.verifyEmail(dto.token);
    return {
      success: true,
      message: 'Email verified successfully',
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async me(
    @GetUser('id') userId: string,
  ): Promise<{ success: boolean; data: any }> {
    const profile = await this.authService.getProfile(userId);
    return {
      success: true,
      data: profile,
    };
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all active device sessions' })
  async getSessions(
    @GetUser('id') userId: string,
  ): Promise<{ success: boolean; data: any[] }> {
    const sessions = await this.authService.getSessions(userId);
    return {
      success: true,
      data: sessions,
    };
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke specific device session' })
  async revokeSession(
    @GetUser('id') userId: string,
    @Param('id') sessionId: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.authService.revokeSession(userId, sessionId);
    return {
      success: true,
      message: 'Session revoked successfully',
    };
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password while logged in' })
  async changePassword(
    @GetUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.authService.changePassword(userId, dto);
    return {
      success: true,
      message: 'Password updated successfully',
    };
  }

  // Private Helper methods to write secure cookies
  private setTokenCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ): void {
    // 15 mins access token cookie
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000, // 15 mins
    });

    // 30 days refresh token cookie
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
  }

  private clearTokenCookies(res: Response): void {
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
  }
}
