import { Module } from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { ConversationController } from './conversation.controller';
import { ProjectModule } from '../project/project.module';
import { CommunicationUserModule } from '../communication-user/communication-user.module';
import { PresenceModule } from '../realtime/presence/presence.module';

@Module({
  imports: [ProjectModule, CommunicationUserModule, PresenceModule],
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}

