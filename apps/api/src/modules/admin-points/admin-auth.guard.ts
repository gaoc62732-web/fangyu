import { ForbiddenException, Injectable, type ExecutionContext, type CanActivate } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The point editor is a local JSON maintenance service. It deliberately has
 * no account or database dependency; the network boundary is the permission
 * boundary and only loopback clients are accepted.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const address = request.socket.remoteAddress || request.ip || '';
    const loopback = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
    if (!loopback) throw new ForbiddenException('本机 JSON 管理服务只接受本机请求');
    return true;
  }
}
