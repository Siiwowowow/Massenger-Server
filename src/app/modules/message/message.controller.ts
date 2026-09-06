import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { MessageService } from './message.service';
import { CommunicationAuthGuard } from '../communication-user/guards/communication-auth.guard';
import { CurrentCommunicationUser } from '../communication-user/decorators/current-communication-user.decorator';
import { CurrentProject } from '../project/decorators/current-project.decorator';
import { Project, CommunicationUser } from '../../../generated/prisma';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  SendMessageDto,
  sendMessageSchema,
  UpdateMessageDto,
  updateMessageSchema,
  QueryMessagesDto,
  queryMessagesSchema,
} from './dto/message.dto';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@UseGuards(CommunicationAuthGuard)
@Controller()
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @Post('conversations/:conversationId/messages')
  @UsePipes(new ZodValidationPipe(sendMessageSchema))
  async send(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    const data = await this.messageService.sendMessage(
      project.id,
      conversationId,
      user.id,
      dto,
    );
    return {
      message: 'Message sent successfully',
      data,
    };
  }

  @Get('conversations/:conversationId/messages')
  @UsePipes(new ZodValidationPipe(queryMessagesSchema))
  async findAll(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('conversationId') conversationId: string,
    @Query() query: QueryMessagesDto,
  ) {
    const data = await this.messageService.findMessages(
      project.id,
      conversationId,
      user.id,
      query,
    );
    return {
      message: 'Messages retrieved successfully',
      data,
    };
  }

  @Get('messages/:messageId')
  async findOne(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('messageId') messageId: string,
  ) {
    const data = await this.messageService.findMessageById(
      project.id,
      messageId,
      user.id,
    );
    return {
      message: 'Message retrieved successfully',
      data,
    };
  }

  @Patch('messages/:messageId')
  @UsePipes(new ZodValidationPipe(updateMessageSchema))
  async update(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('messageId') messageId: string,
    @Body() dto: UpdateMessageDto,
  ) {
    const data = await this.messageService.updateMessage(
      project.id,
      messageId,
      user.id,
      dto,
    );
    return {
      message: 'Message updated successfully',
      data,
    };
  }

  @Delete('messages/:messageId')
  async remove(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('messageId') messageId: string,
  ) {
    return this.messageService.deleteMessage(
      project.id,
      messageId,
      user.id,
    );
  }
}
