import { ObjectType, Field, ID, registerEnumType, Int } from '@nestjs/graphql';
import { ProjectStatus } from '../../../../generated/prisma';

registerEnumType(ProjectStatus, {
  name: 'ProjectStatus',
  description: 'Project operational status',
});

@ObjectType('Project', { description: 'Project tenant entity for communication isolation' })
export class ProjectEntity {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field()
  slug!: string;

  @Field()
  apiKey!: string;

  @Field()
  apiSecret!: string;

  @Field(() => ProjectStatus)
  status!: ProjectStatus;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;

  @Field(() => Int, { nullable: true, description: 'Total communication users in project' })
  totalUsers?: number;

  @Field(() => Int, { nullable: true, description: 'Total conversations in project' })
  totalConversations?: number;
}

@ObjectType('PaginationMeta', { description: 'Pagination metadata' })
export class PaginationMetaEntity {
  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  limit!: number;

  @Field(() => Int)
  totalItems!: number;

  @Field(() => Int)
  totalPages!: number;

  @Field(() => Boolean)
  hasNextPage!: boolean;

  @Field(() => Boolean)
  hasPreviousPage!: boolean;
}

@ObjectType('ProjectPagination', { description: 'Paginated project response' })
export class ProjectPaginationEntity {
  @Field(() => [ProjectEntity])
  data!: ProjectEntity[];

  @Field(() => PaginationMetaEntity)
  meta!: PaginationMetaEntity;
}
