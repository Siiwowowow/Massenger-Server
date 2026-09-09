import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { WsAuthGuard } from './guards/websocket-auth.guard';
import { ProjectModule } from '../project/project.module';
import { CommunicationUserModule } from '../communication-user/communication-user.module';
import { ConversationModule } from '../conversation/conversation.module';
import { MessageModule } from '../message/message.module';
import { PresenceModule } from './presence/presence.module';
import { TypingModule } from './typing/typing.module';
import { CallModule } from '../call/call.module';

@Module({
  imports: [
    ProjectModule,
    CommunicationUserModule,
    ConversationModule,
    MessageModule,
    PresenceModule,
    TypingModule,
    CallModule,
  ],
  providers: [RealtimeGateway, WsAuthGuard],
  exports: [RealtimeGateway, WsAuthGuard, PresenceModule, TypingModule],
})
export class RealtimeModule {}

