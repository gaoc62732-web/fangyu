import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { auth } from './auth.js';

export interface AuthenticatedRequest extends Request {
  user: { id: string };
}

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      const expected = process.env.WEB_ORIGIN || 'http://localhost:5173';
      if (origin && origin !== expected) throw new ForbiddenException('请求来源不被允许');
    }
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new UnauthorizedException('请先登录');
    request.user = { id: session.user.id };
    return true;
  }
}
