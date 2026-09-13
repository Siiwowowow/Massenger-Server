import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { NotFoundException } from '../../common/exceptions/domain.exceptions';
import {
  SyncCommunicationUserDto,
  QueryCommunicationUsersDto,
} from './dto/communication-user.dto';

@Injectable()
export class CommunicationUserService {
  private readonly logger = new Logger(CommunicationUserService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sync(projectId: string, dto: SyncCommunicationUserDto) {
    const user = await this.prisma.communicationUser.upsert({
      where: {
        projectId_externalId: {
          projectId,
          externalId: dto.externalId.trim(),
        },
      },
      create: {
        projectId,
        externalId: dto.externalId.trim(),
        name: dto.name.trim(),
        email: dto.email ? dto.email.toLowerCase().trim() : null,
        avatar: dto.avatar || null,
        isOnline: true,
        lastSeenAt: null,
      },
      update: {
        name: dto.name.trim(),
        ...(dto.email !== undefined
          ? { email: dto.email ? dto.email.toLowerCase().trim() : null }
          : {}),
        ...(dto.avatar !== undefined ? { avatar: dto.avatar || null } : {}),
        isOnline: true,
        lastSeenAt: null,
      },
    });

    this.logger.log(
      `Synced communication user: ${user.name} (${user.externalId}) for project: ${projectId}`,
    );
    return user;
  }

  async findById(projectId: string, id: string) {
    const user = await this.prisma.communicationUser.findFirst({
      where: {
        id,
        projectId,
      },
    });

    if (!user) {
      throw new NotFoundException('CommunicationUser', id);
    }

    return user;
  }

  async findByExternalId(projectId: string, externalId: string) {
    const user = await this.prisma.communicationUser.findUnique({
      where: {
        projectId_externalId: {
          projectId,
          externalId: externalId.trim(),
        },
      },
    });

    if (!user) {
      throw new NotFoundException('CommunicationUser', externalId);
    }

    return user;
  }

  async findAll(
    projectId: string,
    query: QueryCommunicationUsersDto,
    excludeUserId?: string,
    excludeExternalId?: string,
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;
    const cleanSearch = query.search ? query.search.trim() : '';

    // Auto-discover & provision registered users from the system User table
    let validExternalIds: string[] = [];
    try {
      const registeredUsers = await this.prisma.user.findMany({
        where: cleanSearch
          ? {
              OR: [
                { name: { contains: cleanSearch } },
                { email: { contains: cleanSearch } },
              ],
            }
          : {},
        take: 50,
      });

      if (registeredUsers.length > 0) {
        await Promise.all(
          registeredUsers.map((regUser) =>
            this.prisma.communicationUser.upsert({
              where: {
                projectId_externalId: {
                  projectId,
                  externalId: regUser.id,
                },
              },
              create: {
                projectId,
                externalId: regUser.id,
                name: regUser.name || 'User',
                email: regUser.email ? regUser.email.toLowerCase().trim() : null,
                avatar: regUser.image || null,
              },
              update: {
                name: regUser.name || undefined,
                email: regUser.email ? regUser.email.toLowerCase().trim() : undefined,
                ...(regUser.image ? { avatar: regUser.image } : {}),
              },
            }),
          ),
        );
      }

      const allRegistered = await this.prisma.user.findMany({ select: { id: true } });
      validExternalIds = allRegistered.map((u) => u.id);
    } catch (syncErr) {
      this.logger.warn(`Could not auto-sync registered users for search: ${(syncErr as any)?.message}`);
    }

    const where: any = {
      projectId,
    };

    // Ensure only real registered users in User table are returned (filter out any orphans)
    if (validExternalIds.length > 0) {
      where.externalId = { in: validExternalIds };
    }

    // Exclude requester's own profile from search results
    const excludeFilters: any[] = [];
    if (excludeUserId) {
      excludeFilters.push({ id: { not: excludeUserId } }, { externalId: { not: excludeUserId } });
    }
    if (excludeExternalId) {
      excludeFilters.push({ externalId: { not: excludeExternalId } }, { id: { not: excludeExternalId } });
    }

    if (cleanSearch) {
      excludeFilters.push({
        OR: [
          { name: { contains: cleanSearch } },
          { email: { contains: cleanSearch } },
        ],
      });
    }

    if (excludeFilters.length > 0) {
      where.AND = excludeFilters;
    }

    const [totalItems, data] = await Promise.all([
      this.prisma.communicationUser.count({ where }),
      this.prisma.communicationUser.findMany({
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

  async updateOnlineStatus(userId: string, isOnline: boolean) {
    return this.prisma.communicationUser.update({
      where: { id: userId },
      data: {
        isOnline,
        ...(isOnline ? {} : { lastSeenAt: new Date() }),
      },
    });
  }
}
