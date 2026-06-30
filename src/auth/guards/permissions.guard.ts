import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  private readonly rolePermissions: Record<Role, string[]> = {
    [Role.USER]: [
      'read:plans',
      'read:countries',
      'manage:own-profile',
      'manage:own-orders',
      'manage:own-support',
    ],
    [Role.ADMIN]: [
      'read:plans',
      'write:plans',
      'read:countries',
      'write:countries',
      'read:coupons',
      'write:coupons',
      'read:orders',
      'write:refunds',
      'read:users',
      'manage:support',
      'read:provider-config',
      'read:reports',
    ],
    [Role.SUPERADMIN]: ['*'], // Wildcard matches all permissions
  };

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.role) {
      throw new ForbiddenException('Access denied: insufficient credentials');
    }

    const userPermissions = this.rolePermissions[user.role as Role] || [];

    // If user is SUPERADMIN or role has wildcard permission, allow access
    if (userPermissions.includes('*')) {
      return true;
    }

    // Verify user possesses all required permissions
    const hasAllPermissions = requiredPermissions.every((perm) => userPermissions.includes(perm));

    if (!hasAllPermissions) {
      throw new ForbiddenException('Access denied: insufficient permissions');
    }

    return true;
  }
}
