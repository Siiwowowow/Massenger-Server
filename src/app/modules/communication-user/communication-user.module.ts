import { Module } from '@nestjs/common';
import { CommunicationUserService } from './communication-user.service';
import { CommunicationUserController } from './communication-user.controller';
import { CommunicationAuthGuard } from './guards/communication-auth.guard';
import { ProjectModule } from '../project/project.module';
import { PresenceModule } from '../realtime/presence/presence.module';

@Module({
  imports: [ProjectModule, PresenceModule],
  controllers: [CommunicationUserController],
  providers: [CommunicationUserService, CommunicationAuthGuard],
  exports: [CommunicationUserService, CommunicationAuthGuard],
})
export class CommunicationUserModule {}

