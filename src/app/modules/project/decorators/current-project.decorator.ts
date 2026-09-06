import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Project } from '../../../../generated/prisma';

export const CurrentProject = createParamDecorator(
  (data: keyof Project | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const project = req.project as Project | undefined;

    if (!project) {
      return null;
    }

    return data ? project[data] : project;
  },
);
