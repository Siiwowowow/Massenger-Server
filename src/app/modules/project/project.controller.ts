import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ProjectService } from './project.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CreateProjectDto,
  createProjectSchema,
  UpdateProjectDto,
  updateProjectSchema,
} from './dto/project.dto';
import {
  PaginationQueryDto,
  paginationQuerySchema,
} from '../../common/dto/pagination.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @UsePipes(new ZodValidationPipe(createProjectSchema))
  async create(@Body() dto: CreateProjectDto) {
    const data = await this.projectService.create(dto);
    return {
      message: 'Project created successfully',
      data,
    };
  }

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @UsePipes(new ZodValidationPipe(paginationQuerySchema))
  async findAll(@Query() query: PaginationQueryDto) {
    return this.projectService.findAll(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.projectService.findById(id);
    return {
      message: 'Project retrieved successfully',
      data,
    };
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @UsePipes(new ZodValidationPipe(updateProjectSchema))
  async update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    const data = await this.projectService.update(id, dto);
    return {
      message: 'Project updated successfully',
      data,
    };
  }

  @Post(':id/regenerate-keys')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async regenerateKeys(@Param('id') id: string) {
    const data = await this.projectService.regenerateKeys(id);
    return {
      message: 'Project API keys regenerated successfully',
      data,
    };
  }
}
