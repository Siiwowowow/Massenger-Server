import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Headers,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { CommunicationUserService } from './communication-user.service';
import { PresenceService } from '../realtime/presence/presence.service';
import { ProjectGuard } from '../project/guards/project.guard';
import { CurrentProject } from '../project/decorators/current-project.decorator';
import { Project } from '../../../generated/prisma';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  SyncCommunicationUserDto,
  syncCommunicationUserSchema,
  QueryCommunicationUsersDto,
  queryCommunicationUsersSchema,
} from './dto/communication-user.dto';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@UseGuards(ProjectGuard)
@Controller(['projects/:projectId/users', 'communication-users'])
export class CommunicationUserController {
  constructor(
    private readonly communicationUserService: CommunicationUserService,
    private readonly presenceService: PresenceService,
  ) {}

  @Post('sync')
  @UsePipes(new ZodValidationPipe(syncCommunicationUserSchema))
  async sync(
    @CurrentProject() project: Project,
    @Body() dto: SyncCommunicationUserDto,
  ) {
    const data = await this.communicationUserService.sync(project.id, dto);
    return {
      message: 'Communication user synced successfully',
      data,
    };
  }

  @Get()
  @UsePipes(new ZodValidationPipe(queryCommunicationUsersSchema))
  async findAll(
    @CurrentProject() project: Project,
    @Query() query: QueryCommunicationUsersDto,
    @Headers('x-user-id') xUserId?: string,
    @Headers('x-external-id') xExternalId?: string,
  ) {
    return this.communicationUserService.findAll(
      project.id,
      query,
      xUserId,
      xExternalId,
    );
  }

  @Get('id/:id')
  async findById(
    @CurrentProject() project: Project,
    @Param('id') id: string,
  ) {
    const data = await this.communicationUserService.findById(project.id, id);
    return {
      message: 'Communication user retrieved successfully',
      data,
    };
  }

  @Get(':userId/presence')
  async getPresence(
    @CurrentProject() project: Project,
    @Param('userId') userId: string,
  ) {
    const data = await this.presenceService.getPresence(project.id, userId);
    return {
      message: 'User presence retrieved successfully',
      data,
    };
  }

  @Get(':externalId')
  async findByExternalId(
    @CurrentProject() project: Project,
    @Param('externalId') externalId: string,
  ) {
    const data = await this.communicationUserService.findByExternalId(
      project.id,
      externalId,
    );
    return {
      message: 'Communication user retrieved successfully',
      data,
    };
  }
}
