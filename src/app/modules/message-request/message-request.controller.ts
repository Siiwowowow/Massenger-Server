import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { MessageRequestService } from './message-request.service';
import { CommunicationAuthGuard } from '../communication-user/guards/communication-auth.guard';
import { CurrentCommunicationUser } from '../communication-user/decorators/current-communication-user.decorator';
import { CurrentProject } from '../project/decorators/current-project.decorator';
import { Project, CommunicationUser } from '../../../generated/prisma';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CreateMessageRequestDto,
  createMessageRequestSchema,
} from './dto/message-request.dto';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@UseGuards(CommunicationAuthGuard)
@Controller('message-requests')
export class MessageRequestController {
  constructor(private readonly messageRequestService: MessageRequestService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(createMessageRequestSchema))
  async sendRequest(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Body() dto: CreateMessageRequestDto,
  ) {
    const data = await this.messageRequestService.sendRequest(
      project.id,
      user.id,
      dto,
    );
    return {
      message: 'Message request sent successfully',
      data,
    };
  }

  @Get('incoming')
  async getIncoming(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
  ) {
    return this.messageRequestService.getIncoming(project.id, user.id);
  }

  @Get('outgoing')
  async getOutgoing(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
  ) {
    return this.messageRequestService.getOutgoing(project.id, user.id);
  }

  @Patch(':requestId/accept')
  async acceptRequest(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('requestId') requestId: string,
  ) {
    const data = await this.messageRequestService.acceptRequest(
      project.id,
      user.id,
      requestId,
    );
    return {
      message: 'Message request accepted successfully',
      data,
    };
  }

  @Patch(':requestId/reject')
  async rejectRequest(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('requestId') requestId: string,
  ) {
    const data = await this.messageRequestService.rejectRequest(
      project.id,
      user.id,
      requestId,
    );
    return {
      message: 'Message request declined successfully',
      data,
    };
  }

  @Delete(':requestId')
  async cancelRequest(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('requestId') requestId: string,
  ) {
    return this.messageRequestService.cancelRequest(
      project.id,
      user.id,
      requestId,
    );
  }
}
