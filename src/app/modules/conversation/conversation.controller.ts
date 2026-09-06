import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { PresenceService } from '../realtime/presence/presence.service';
import { CommunicationAuthGuard } from '../communication-user/guards/communication-auth.guard';
import { CurrentCommunicationUser } from '../communication-user/decorators/current-communication-user.decorator';
import { CurrentProject } from '../project/decorators/current-project.decorator';
import {
  Project,
  CommunicationUser,
} from '../../../generated/prisma';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CreateDirectConversationDto,
  createDirectConversationSchema,
  CreateGroupConversationDto,
  createGroupConversationSchema,
  AddParticipantDto,
  addParticipantSchema,
  QueryConversationsDto,
  queryConversationsSchema,
} from './dto/conversation.dto';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@UseGuards(CommunicationAuthGuard)
@Controller('conversations')
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly presenceService: PresenceService,
  ) {}

  @Post('direct')
  @UsePipes(new ZodValidationPipe(createDirectConversationSchema))
  async createDirect(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Body() dto: CreateDirectConversationDto,
  ) {
    const data = await this.conversationService.createDirect(
      project.id,
      user.id,
      dto.participantId,
    );
    return {
      message: 'Direct conversation resolved successfully',
      data,
    };
  }

  @Post('group')
  @UsePipes(new ZodValidationPipe(createGroupConversationSchema))
  async createGroup(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Body() dto: CreateGroupConversationDto,
  ) {
    const data = await this.conversationService.createGroup(
      project.id,
      user.id,
      dto,
    );
    return {
      message: 'Group conversation created successfully',
      data,
    };
  }

  @Get()
  @UsePipes(new ZodValidationPipe(queryConversationsSchema))
  async findAll(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Query() query: QueryConversationsDto,
  ) {
    return this.conversationService.findUserConversations(
      project.id,
      user.id,
      query,
    );
  }

  @Get(':conversationId')
  async findOne(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('conversationId') conversationId: string,
  ) {
    const data = await this.conversationService.findById(
      project.id,
      conversationId,
      user.id,
    );
    return {
      message: 'Conversation retrieved successfully',
      data,
    };
  }

  @Get(':conversationId/participants')
  async getParticipants(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('conversationId') conversationId: string,
  ) {
    const data = await this.conversationService.getParticipants(
      project.id,
      conversationId,
      user.id,
    );
    return {
      message: 'Conversation participants retrieved successfully',
      data,
    };
  }

  @Get(':conversationId/presence')
  async getPresence(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('conversationId') conversationId: string,
  ) {
    const data = await this.presenceService.getConversationPresence(
      project.id,
      conversationId,
      user.id,
    );
    return {
      message: 'Conversation presence retrieved successfully',
      data,
    };
  }

  @Post(':conversationId/participants')
  @UsePipes(new ZodValidationPipe(addParticipantSchema))
  async addParticipant(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('conversationId') conversationId: string,
    @Body() dto: AddParticipantDto,
  ) {
    const data = await this.conversationService.addParticipant(
      project.id,
      conversationId,
      user.id,
      dto,
    );
    return {
      message: 'Participant added successfully',
      data,
    };
  }

  @Delete(':conversationId/participants/:userId')
  async removeParticipant(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('conversationId') conversationId: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.conversationService.removeParticipant(
      project.id,
      conversationId,
      user.id,
      targetUserId,
    );
  }

  @Post(':conversationId/leave')
  async leave(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversationService.leaveConversation(
      project.id,
      conversationId,
      user.id,
    );
  }
}
