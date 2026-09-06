import { InputType, Field, Int, ID } from '@nestjs/graphql';
import { ProjectStatus } from '../../../../generated/prisma';

@InputType('CreateProjectInput', { description: 'Input for creating a new project' })
export class CreateProjectInput {
  @Field({ description: 'Name of the project' })
  name!: string;

  @Field({ description: 'Unique slug identifier for the project' })
  slug!: string;

  @Field(() => ProjectStatus, { nullable: true, description: 'Initial status of the project' })
  status?: ProjectStatus;
}

@InputType('UpdateProjectInput', { description: 'Input for updating an existing project' })
export class UpdateProjectInput {
  @Field({ nullable: true, description: 'Updated name of the project' })
  name?: string;

  @Field(() => ProjectStatus, { nullable: true, description: 'Updated operational status' })
  status?: ProjectStatus;
}

@InputType('ProjectPaginationInput', { description: 'Query parameters for project pagination and filtering' })
export class ProjectPaginationInput {
  @Field(() => Int, { nullable: true, defaultValue: 1, description: 'Page number (default: 1)' })
  page?: number;

  @Field(() => Int, { nullable: true, defaultValue: 10, description: 'Items per page (default: 10)' })
  limit?: number;

  @Field({ nullable: true, description: 'Optional search term to filter by name or slug' })
  search?: string;
}
