import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { MessageReceiptService } from './message-receipt.service';
import { CommunicationAuthGuard } from '../communication-user/guards/communication-auth.guard';
import { CurrentCommunicationUser } from '../communication-user/decorators/current-communication-user.decorator';
import { CurrentProject } from '../project/decorators/current-project.decorator';
import { Project, CommunicationUser } from '../../../generated/prisma';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  BulkMarkReadDto,
  bulkMarkReadSchema,
} from './dto/receipt.dto';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@UseGuards(CommunicationAuthGuard)
@Controller()
export class MessageReceiptController {
  constructor(private readonly receiptService: MessageReceiptService) {}

  /**
   * Mark a message as delivered
   * POST /api/v1/messages/:messageId/delivered
   */
  @Post('messages/:messageId/delivered')
  async markDelivered(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('messageId') messageId: string,
  ) {
    const data = await this.receiptService.markDelivered(
      project.id,
      messageId,
      user.id,
    );
    return {
      message: 'Message marked as delivered successfully',
      data,
    };
  }

  /**
   * Mark a message as read
   * POST /api/v1/messages/:messageId/read
   */
  @Post('messages/:messageId/read')
  async markRead(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('messageId') messageId: string,
  ) {
    const data = await this.receiptService.markRead(
      project.id,
      messageId,
      user.id,
    );
    return {
      message: 'Message marked as read successfully',
      data,
    };
  }

  /**
   * Get unread counts for all conversations of the current user
   * Placed before parameterized conversation routes to prevent path conflict
   * GET /api/v1/conversations/unread-counts
   */
  @Get('conversations/unread-counts')
  async getUserUnreadCounts(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
  ) {
    const data = await this.receiptService.getUserUnreadCounts(
      project.id,
      user.id,
    );
    return {
      message: 'User conversation unread counts retrieved successfully',
      data,
    };
  }

  /**
   * Bulk mark conversation messages as read
   * POST /api/v1/conversations/:conversationId/read
   */
  @Post('conversations/:conversationId/read')
  @UsePipes(new ZodValidationPipe(bulkMarkReadSchema))
  async markConversationAsRead(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('conversationId') conversationId: string,
    @Body() dto: BulkMarkReadDto,
  ) {
    const data = await this.receiptService.markMessagesAsRead(
      project.id,
      conversationId,
      user.id,
      dto,
    );
    return {
      message: 'Conversation messages marked as read successfully',
      data,
    };
  }

  /**
   * Get unread count for a specific conversation
   * GET /api/v1/conversations/:conversationId/unread-count
   */
  @Get('conversations/:conversationId/unread-count')
  async getUnreadCount(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('conversationId') conversationId: string,
  ) {
    const data = await this.receiptService.getUnreadCount(
      project.id,
      conversationId,
      user.id,
    );
    return {
      message: 'Conversation unread count retrieved successfully',
      data,
    };
  }

  /**
   * Get full read state for a specific conversation
   * GET /api/v1/conversations/:conversationId/read-state
   */
  @Get('conversations/:conversationId/read-state')
  async getConversationReadState(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('conversationId') conversationId: string,
  ) {
    const data = await this.receiptService.getConversationReadState(
      project.id,
      conversationId,
      user.id,
    );
    return {
      message: 'Conversation read state retrieved successfully',
      data,
    };
  }

  /**
   * Get all receipts for a message
   * GET /api/v1/messages/:messageId/receipts
   */
  @Get('messages/:messageId/receipts')
  async getMessageReceipts(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Param('messageId') messageId: string,
  ) {
    const data = await this.receiptService.getMessageReceipts(
      project.id,
      messageId,
      user.id,
    );
    return {
      message: 'Message receipts retrieved successfully',
      data,
    };
  }
}
