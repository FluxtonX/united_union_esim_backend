import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../database/prisma.service';
import { Request } from 'express';

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      return true; // Guest user — allow request to proceed without attaching user
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      const session = await this.prisma.userSession.findUnique({
        where: { id: payload.sessionId },
      });

      if (session) {
        request['user'] = {
          id: payload.sub,
          email: payload.email,
          role: payload.role,
          sessionId: payload.sessionId,
        };
      }
    } catch (_) {
      // Token is invalid/expired — treat as guest user
    }

    return true;
  }

  private extractToken(request: Request): string | null {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    if (request.cookies && request.cookies.access_token) {
      return request.cookies.access_token;
    }
    return null;
  }
}
