import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { errors } from '../../common/errors/application-error';
import type { JanusRequest } from '../../common/http/janus-request';
import { ACCESS_TOKEN_SERVICE, type AccessTokenService } from '../domain/auth.ports';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(@Inject(ACCESS_TOKEN_SERVICE) private readonly accessTokens: AccessTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<JanusRequest>();
    const authorization = request.header('authorization');
    if (!authorization?.startsWith('Bearer ')) throw errors.unauthorized();
    request.auth = await this.accessTokens.verify(authorization.slice(7));
    return true;
  }
}
