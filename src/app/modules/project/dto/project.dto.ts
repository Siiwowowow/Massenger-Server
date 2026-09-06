import { z } from 'zod';
import { ProjectStatus } from '../../../../generated/prisma';

export const createProjectSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(50)
    .regex(
      /^[a-z0-9-]+$/,
      'Slug can only contain lowercase alphanumeric characters and hyphens',
    ),
  status: z.nativeEnum(ProjectStatus).optional(),
});

export type CreateProjectDto = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  status: z.nativeEnum(ProjectStatus).optional(),
});

export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;
