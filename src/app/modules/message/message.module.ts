import { Module } from '@nestjs/common';
import { MessageService } from './message.service';
import { MessageController } from './message.controller';
import { MessageReceiptService } from './message-receipt.service';
import { MessageReceiptController } from './message-receipt.controller';
import { ProjectModule } from '../project/project.module';
import { CommunicationUserModule } from '../communication-user/communication-user.module';
import { ConversationModule } from '../conversation/conversation.module';

@Module({
  imports: [ProjectModule, CommunicationUserModule, ConversationModule],
  controllers: [MessageController, MessageReceiptController],
  providers: [MessageService, MessageReceiptService],
  exports: [MessageService, MessageReceiptService],
})
export class MessageModule {}
