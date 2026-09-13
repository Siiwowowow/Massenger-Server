import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import {
  ConflictException,
  NotFoundException,
} from '../../common/exceptions/domain.exceptions';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ProjectStatus } from '../../../generated/prisma';

@Injectable()
export class ProjectService implements OnModuleInit {
  private readonly logger = new Logger(ProjectService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const projectId = process.env.DEFAULT_PROJECT_ID || '6a9a46e2c13d4f5a5538dcd5';
    const projectName = process.env.DEFAULT_PROJECT_NAME || 'Pulse Messenger';
    const projectSlug = process.env.DEFAULT_PROJECT_SLUG || 'pulse-messenger';

    const existing = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (existing) return;

    const slugOwner = await this.prisma.project.findUnique({ where: { slug: projectSlug } });
    const slug = slugOwner && slugOwner.id !== projectId
      ? `${projectSlug}-${projectId.slice(0, 8)}`
      : projectSlug;

    await this.prisma.project.create({
      data: {
        id: projectId,
        name: projectName,
        slug,
        apiKey: `proj_live_${crypto.randomBytes(16).toString('hex')}`,
        apiSecret: `sk_live_${crypto.randomBytes(32).toString('hex')}`,
        status: ProjectStatus.ACTIVE,
      },
    });

    this.logger.log(`Default project initialized: ${projectName} (${projectId})`);
  }

  async create(dto: CreateProjectDto) {
    const existing = await this.prisma.project.findUnique({
      where: { slug: dto.slug.toLowerCase().trim() },
    });

    if (existing) {
      throw new ConflictException(`Project with slug '${dto.slug}' already exists`);
    }

    const apiKey = `proj_live_${crypto.randomBytes(16).toString('hex')}`;
    const apiSecret = `sk_live_${crypto.randomBytes(32).toString('hex')}`;

    const project = await this.prisma.project.create({
      data: {
        name: dto.name.trim(),
        slug: dto.slug.toLowerCase().trim(),
        apiKey,
        apiSecret,
        status: dto.status || ProjectStatus.ACTIVE,
      },
    });

    this.logger.log(`Project created: ${project.name} (${project.slug}) - ID: ${project.id}`);
    return project;
  }

  async findAll(query: PaginationQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
    const skip = (page - 1) * limit;

    const where = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { slug: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [totalItems, data] = await Promise.all([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const totalPages = Math.ceil(totalItems / limit) || 1;

    return {
      data,
      meta: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async findById(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            communicationUsers: true,
            conversations: true,
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project', id);
    }

    return project;
  }

  async findBySlug(slug: string) {
    const project = await this.prisma.project.findUnique({
      where: { slug: slug.toLowerCase().trim() },
    });

    if (!project) {
      throw new NotFoundException('Project', slug);
    }

    return project;
  }

  async findByApiKey(apiKey: string) {
    return this.prisma.project.findUnique({
      where: { apiKey },
    });
  }

  async update(id: string, dto: UpdateProjectDto) {
    await this.findById(id);

    return this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.status ? { status: dto.status } : {}),
      },
    });
  }

  async regenerateKeys(id: string) {
    await this.findById(id);

    const apiKey = `proj_live_${crypto.randomBytes(16).toString('hex')}`;
    const apiSecret = `sk_live_${crypto.randomBytes(32).toString('hex')}`;

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        apiKey,
        apiSecret,
      },
    });

    this.logger.log(`Regenerated API keys for project: ${updated.slug}`);
    return updated;
  }
}
