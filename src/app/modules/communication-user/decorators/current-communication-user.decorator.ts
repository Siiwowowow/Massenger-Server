import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CommunicationUser } from '../../../../generated/prisma';

export const CurrentCommunicationUser = createParamDecorator(
  (data: keyof CommunicationUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const user = req.communicationUser as CommunicationUser | undefined;

    if (!user) {
      return null;
    }

    return data ? user[data] : user;
  },
);
