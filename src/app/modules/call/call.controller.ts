import {
  Controller,
  Post,
  Body,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { CallService } from './call.service';
import { CommunicationAuthGuard } from '../communication-user/guards/communication-auth.guard';
import { CurrentCommunicationUser } from '../communication-user/decorators/current-communication-user.decorator';
import { CurrentProject } from '../project/decorators/current-project.decorator';
import { Project, CommunicationUser } from '../../../generated/prisma';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { GetCallTokenDto, getCallTokenSchema } from './dto/call.dto';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@UseGuards(CommunicationAuthGuard)
@Controller('calls')
export class CallController {
  constructor(private readonly callService: CallService) {}

  @Post('token')
  @UsePipes(new ZodValidationPipe(getCallTokenSchema))
  async getToken(
    @CurrentProject() project: Project,
    @CurrentCommunicationUser() user: CommunicationUser,
    @Body() dto: GetCallTokenDto,
  ) {
    const data = await this.callService.generateToken(
      project.id,
      user,
      dto.conversationId,
    );

    return {
      message: 'Call token generated successfully',
      data,
    };
  }
}
