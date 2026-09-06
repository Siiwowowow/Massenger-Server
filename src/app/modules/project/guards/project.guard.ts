import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '../../../common/exceptions/domain.exceptions';
import { Project, ProjectStatus } from '../../../../generated/prisma';

@Injectable()
export class ProjectGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

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

    let project: Project | null = null;

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
      throw new NotFoundException(
        'Project',
        String(projectId || apiKey || 'unknown'),
      );
    }

    if (project.status !== ProjectStatus.ACTIVE) {
      throw new ForbiddenException(
        `Project is currently ${project.status.toLowerCase()}. Access is restricted`,
      );
    }

    req.project = project;
    return true;
  }
}
