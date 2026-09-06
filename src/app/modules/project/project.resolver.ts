import {
  Resolver,
  Query,
  Mutation,
  Args,
  ID,
  ResolveField,
  Parent,
  Int,
} from '@nestjs/graphql';
import { ProjectService } from './project.service';
import {
  ProjectEntity,
  ProjectPaginationEntity,
} from './entities/project.entity';
import {
  CreateProjectInput,
  UpdateProjectInput,
  ProjectPaginationInput,
} from './dto/project.input';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { PrismaService } from '../../database/prisma.service';

@Resolver(() => ProjectEntity)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class ProjectResolver {
  constructor(
    private readonly projectService: ProjectService,
    private readonly prisma: PrismaService,
  ) {}

  @Query(() => ProjectPaginationEntity, {
    name: 'projects',
    description: 'Get paginated list of projects with search support (Admin only)',
  })
  async getProjects(
    @Args('input', { nullable: true, type: () => ProjectPaginationInput })
    input?: ProjectPaginationInput,
  ): Promise<ProjectPaginationEntity> {
    const result = await this.projectService.findAll({
      page: input?.page ?? 1,
      limit: input?.limit ?? 10,
      search: input?.search,
      sortBy: '',
      sortOrder: 'asc'
    });
    return result as unknown as ProjectPaginationEntity;
  }

  @Query(() => ProjectEntity, {
    name: 'project',
    description: 'Get a single project by ID (Admin only)',
  })
  async getProject(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ProjectEntity> {
    const project = await this.projectService.findById(id);
    return project as unknown as ProjectEntity;
  }

  @Query(() => ProjectEntity, {
    name: 'projectBySlug',
    description: 'Get a single project by its unique slug (Admin only)',
  })
  async getProjectBySlug(
    @Args('slug', { type: () => String }) slug: string,
  ): Promise<ProjectEntity> {
    const project = await this.projectService.findBySlug(slug);
    return project as unknown as ProjectEntity;
  }

  @Mutation(() => ProjectEntity, {
    description: 'Create a new project tenant (Admin only)',
  })
  async createProject(
    @Args('input') input: CreateProjectInput,
  ): Promise<ProjectEntity> {
    const project = await this.projectService.create(input);
    return project as unknown as ProjectEntity;
  }

  @Mutation(() => ProjectEntity, {
    description: 'Update project details or operational status (Admin only)',
  })
  async updateProject(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateProjectInput,
  ): Promise<ProjectEntity> {
    const project = await this.projectService.update(id, input);
    return project as unknown as ProjectEntity;
  }

  @Mutation(() => ProjectEntity, {
    description: 'Regenerate API Key and Secret for a project (Admin only)',
  })
  async regenerateProjectKeys(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ProjectEntity> {
    const project = await this.projectService.regenerateKeys(id);
    return project as unknown as ProjectEntity;
  }

  @ResolveField(() => Int, {
    nullable: true,
    description: 'Count of communication users associated with this project',
  })
  async totalUsers(
    @Parent() project: ProjectEntity & { _count?: { communicationUsers?: number } },
  ): Promise<number> {
    if (project._count?.communicationUsers !== undefined) {
      return project._count.communicationUsers;
    }
    return this.prisma.communicationUser.count({
      where: { projectId: project.id },
    });
  }

  @ResolveField(() => Int, {
    nullable: true,
    description: 'Count of active conversations in this project',
  })
  async totalConversations(
    @Parent() project: ProjectEntity & { _count?: { conversations?: number } },
  ): Promise<number> {
    if (project._count?.conversations !== undefined) {
      return project._count.conversations;
    }
    return this.prisma.conversation.count({
      where: { projectId: project.id },
    });
  }
}
