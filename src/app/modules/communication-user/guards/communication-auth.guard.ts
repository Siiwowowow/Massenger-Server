import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import {
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '../../../common/exceptions/domain.exceptions';
import { CommunicationUser, ProjectStatus } from '../../../../generated/prisma';

@Injectable()
export class CommunicationAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    // 1. Ensure project context is present
    let project = req.project;
    if (!project) {
      const projectId =
        req.headers['x-project-id'] ||
        req.params?.projectId ||
        req.query?.projectId;
      const apiKey = req.headers['x-api-key'];

      if (!projectId && !apiKey) {
        throw new BadRequestException(
          'Project context is required. Provide x-project-id, x-api-key header, or projectId route parameter',
        );
      }

      if (apiKey) {
        project = await this.prisma.project.findUnique({
          where: { apiKey: String(apiKey) },
        });
      } else if (projectId) {
        project = await this.prisma.project.findUnique({
          where: { id: String(projectId) },
        });
      }

      if (!project) {
        throw new UnauthorizedException('Invalid project context');
      }

      if (project.status !== ProjectStatus.ACTIVE) {
        throw new ForbiddenException(
          `Project is currently ${project.status.toLowerCase()}. Access is restricted`,
        );
      }

      req.project = project;
    }

    // 2. Resolve communication user identity
    let commUser: CommunicationUser | null = null;
    const xUserId = req.headers['x-user-id'];
    const xExternalId = req.headers['x-external-id'];

    if (xUserId) {
      commUser = await this.prisma.communicationUser.findFirst({
        where: {
          projectId: project.id,
          OR: [
            { id: String(xUserId) },
            { externalId: String(xUserId) },
          ],
        },
      });

      if (!commUser) {
        // Attempt lazy sync if user exists in auth User table
        const sysUser = await this.prisma.user.findUnique({
          where: { id: String(xUserId) },
        });

        if (sysUser) {
          commUser = await this.prisma.communicationUser.upsert({
            where: {
              projectId_externalId: {
                projectId: project.id,
                externalId: sysUser.id,
              },
            },
            create: {
              projectId: project.id,
              externalId: sysUser.id,
              name: sysUser.name || 'User',
              email: sysUser.email ? sysUser.email.toLowerCase().trim() : null,
              avatar: sysUser.image || null,
            },
            update: {
              name: sysUser.name || undefined,
              email: sysUser.email ? sysUser.email.toLowerCase().trim() : undefined,
              ...(sysUser.image ? { avatar: sysUser.image } : {}),
            },
          });
        }
      }

      if (!commUser) {
        throw new UnauthorizedException(
          `Communication user with ID '${xUserId}' not found in current project`,
        );
      }
    } else if (xExternalId) {
      commUser = await this.prisma.communicationUser.findUnique({
        where: {
          projectId_externalId: {
            projectId: project.id,
            externalId: String(xExternalId).trim(),
          },
        },
      });

      if (!commUser) {
        throw new UnauthorizedException(
          `Communication user with externalId '${xExternalId}' not found in current project`,
        );
      }
    } else if (req.user && req.user.id) {
      // Authenticated user via Better Auth or JWT Bearer token
      commUser = await this.prisma.communicationUser.findFirst({
        where: {
          projectId: project.id,
          OR: [
            { id: req.user.id },
            { externalId: req.user.id },
          ],
        },
      });

      // Auto-sync if not present yet for authenticated user in this project
      if (!commUser) {
        commUser = await this.prisma.communicationUser.upsert({
          where: {
            projectId_externalId: {
              projectId: project.id,
              externalId: req.user.id,
            },
          },
          create: {
            projectId: project.id,
            externalId: req.user.id,
            name: req.user.name || 'User',
            email: req.user.email ? req.user.email.toLowerCase() : null,
            avatar: req.user.image || null,
          },
          update: {
            name: req.user.name || undefined,
            email: req.user.email ? req.user.email.toLowerCase() : undefined,
            avatar: req.user.image || undefined,
          },
        });
      }
    }

    if (!commUser) {
      throw new UnauthorizedException(
        'Communication user identity required. Authenticate or provide x-user-id / x-external-id header',
      );
    }

    req.communicationUser = commUser;
    return true;
  }
}
