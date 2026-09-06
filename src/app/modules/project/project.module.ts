import { Module } from '@nestjs/common';
import { ProjectService } from './project.service';
import { ProjectController } from './project.controller';
import { ProjectGuard } from './guards/project.guard';
import { ProjectResolver } from './project.resolver';

@Module({
  controllers: [ProjectController],
  providers: [ProjectService, ProjectGuard, ProjectResolver],
  exports: [ProjectService, ProjectGuard, ProjectResolver],
})
export class ProjectModule {}
