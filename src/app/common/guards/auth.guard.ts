import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { IS_PUBLIC_KEY } from '../constants/metadata.constants';
import { UnauthorizedException, ForbiddenException } from '../exceptions/domain.exceptions';
import { UserStatus } from '../enums/user-status.enum';
import { auth } from '../../auth/better-auth.instance';
import { RequestWithUser } from '../interfaces/request-context.interface';
import { JwtUtil } from '../utils/jwt/jwt.util';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    let req: RequestWithUser;
    let isGraphQL = false;

    if (context.getType().toString() === 'graphql') {
      isGraphQL = true;
      const gqlContext = GqlExecutionContext.create(context);
      const ctx = gqlContext.getContext();
      req = ctx.req || ctx;
    } else {
      req = context.switchToHttp().getRequest();
    }

    try {
      // 1. Try Better Auth session
      const sessionData = await auth.api.getSession({
        headers: new Headers(req.headers as any),
      });

      if (sessionData && sessionData.user) {
        const user = sessionData.user as any;
        const session = sessionData.session as any;

        if (user.status === UserStatus.SUSPENDED) {
          throw new ForbiddenException('Your account has been suspended. Please contact support.');
        }

        if (user.status === UserStatus.INACTIVE) {
          throw new ForbiddenException('Your account is inactive.');
        }

        req.user = user;
        req.session = session;

        if (isGraphQL) {
          const gqlContext = GqlExecutionContext.create(context);
          const ctx = gqlContext.getContext();
          ctx.user = user;
          ctx.session = session;
        }

        return true;
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
    }

    // 2. Fallback: Check for JWT Access Token (Authorization header or Cookie)
    try {
      let token: string | undefined;
      const authHeader = req.headers?.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }

      if (!token && req.cookies?.accessToken) {
        token = req.cookies.accessToken;
      }

      if (!token && req.headers?.cookie) {
        const match = req.headers.cookie
          .split(';')
          .find((c) => c.trim().startsWith('accessToken='));
        if (match) {
          token = match.split('=')[1]?.trim();
        }
      }

      if (token) {
        let decoded: any = null;
        try {
          decoded = JwtUtil.verifyAccessToken(token);
        } catch {
          // Token invalid or expired
        }

        const userId = decoded?.id || decoded?.userId || decoded?._id || decoded?.sub;
        const userEmail = decoded?.email;

        if (userId || userEmail) {
          const user = await this.prisma.user.findUnique({
            where: userId ? { id: userId } : { email: userEmail.toLowerCase() },
          });

          if (user) {
            if (user.status === UserStatus.SUSPENDED) {
              throw new ForbiddenException('Your account has been suspended. Please contact support.');
            }

            if (user.status === UserStatus.INACTIVE) {
              throw new ForbiddenException('Your account is inactive.');
            }

            req.user = user as any;
            if (isGraphQL) {
              const gqlContext = GqlExecutionContext.create(context);
              const ctx = gqlContext.getContext();
              ctx.user = user;
            }

            return true;
          }
        }
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
    }

    if (isPublic) {
      return true;
    }

    throw new UnauthorizedException('Authentication required to access this resource');
  }
}

