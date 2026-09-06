import { Module } from '@nestjs/common';
import { MessageRequestService } from './message-request.service';
import { MessageRequestController } from './message-request.controller';
import { ProjectModule } from '../project/project.module';
import { CommunicationUserModule } from '../communication-user/communication-user.module';
import { ConversationModule } from '../conversation/conversation.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    ProjectModule,
    CommunicationUserModule,
    ConversationModule,
    RealtimeModule,
  ],
  controllers: [MessageRequestController],
  providers: [MessageRequestService],
  exports: [MessageRequestService],
})
export class MessageRequestModule {}
