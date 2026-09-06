import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { AuthenticatedSocket } from '../realtime.types';
import { RealtimeErrorCode } from '../realtime.constants';

@Injectable()
export class WsAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<AuthenticatedSocket>();

    if (!client?.data?.project || !client?.data?.communicationUser) {
      throw new WsException({
        code: RealtimeErrorCode.UNAUTHORIZED,
        message:
          'Socket connection is not authenticated with valid project and user context',
      });
    }

    return true;
  }
}
