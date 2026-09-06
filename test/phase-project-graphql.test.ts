/* eslint-disable no-useless-assignment */
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaClient, Role, UserStatus } from '../src/generated/prisma';
import { PrismaService } from '../src/app/database/prisma.service';
import { JwtUtil } from '../src/app/common/utils/jwt/jwt.util';

async function graphqlPost(url: string, query: string, variables?: any, token?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  return res.json();
}

export async function runProjectGraphQLTests() {
  console.log('🧪 Starting Project GraphQL E2E Verification Suite...\n');

  const prisma = new PrismaClient() as unknown as PrismaService;
  let app: INestApplication | null = null;
  let graphqlUrl = '';

  const timestamp = Date.now();
  const testSlug = `gql-proj-${timestamp}`;
  let adminToken = '';
  let adminUserId = '';
  let createdProjectId = '';

  try {
    // Step 0: Bootstrap app
    console.log('0️⃣ Bootstrapping NestJS application for GraphQL E2E harness...');
    app = await NestFactory.create(AppModule, { logger: ['warn', 'error'] });
    app.setGlobalPrefix('api/v1', { exclude: ['', '/', 'health', 'graphql'] });
    await app.listen(0);

    const httpServer = app.getHttpServer();
    const address = httpServer.address();
    const port = typeof address === 'string' ? address : address.port;
    graphqlUrl = `http://localhost:${port}/graphql`;
    console.log(`   ✅ GraphQL Endpoint available at ${graphqlUrl}\n`);

    // Step 1: Create or find admin user
    console.log('1️⃣ Setting up Admin credentials for GraphQL operations...');
    const adminEmail = `admin_gql_${timestamp}@test.local`;
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'GraphQL Admin Test',
        role: Role.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      },
    });
    adminUserId = admin.id;

    const { accessToken } = JwtUtil.generateTokens({
      id: admin.id,
      email: admin.email,
      role: admin.role,
      status: admin.status,
      name: admin.name,
    });
    adminToken = accessToken;
    console.log(`   ✅ Admin authenticated (Bearer token issued)\n`);

    // Step 2: Test unauthenticated query rejection
    console.log('2️⃣ Testing GraphQL Auth Guard: unauthenticated query to `projects`...');
    const unauthRes = await graphqlPost(graphqlUrl, `
      query {
        projects {
          data { id name }
        }
      }
    `);
    if (unauthRes.errors && unauthRes.errors.length > 0) {
      console.log('   ✅ Unauthenticated request correctly rejected with error:', unauthRes.errors[0].message);
    } else {
      throw new Error('Unauthenticated request was unexpectedly allowed!');
    }

    // Step 3: Test createProject mutation
    console.log('\n3️⃣ Testing `createProject` GraphQL Mutation...');
    const createMutation = `
      mutation CreateProject($input: CreateProjectInput!) {
        createProject(input: $input) {
          id
          name
          slug
          apiKey
          apiSecret
          status
          createdAt
        }
      }
    `;
    const createRes = await graphqlPost(graphqlUrl, createMutation, {
      input: {
        name: 'GraphQL Test Project',
        slug: testSlug,
      },
    }, adminToken);

    if (createRes.errors) {
      throw new Error(`CreateProject failed: ${JSON.stringify(createRes.errors)}`);
    }

    const created = createRes.data?.createProject;
    createdProjectId = created.id;
    console.log(`   ✅ Project created via GraphQL: ID=${created.id}, Slug=${created.slug}, APIKey=${created.apiKey.slice(0, 15)}...`);

    // Step 4: Test query projects (paginated)
    console.log('\n4️⃣ Testing `projects` GraphQL Query...');
    const projectsQuery = `
      query GetProjects($input: ProjectPaginationInput) {
        projects(input: $input) {
          data {
            id
            name
            slug
            status
            totalUsers
            totalConversations
          }
          meta {
            page
            limit
            totalItems
            totalPages
          }
        }
      }
    `;
    const projectsRes = await graphqlPost(graphqlUrl, projectsQuery, {
      input: { search: testSlug, limit: 5 },
    }, adminToken);

    if (projectsRes.errors) {
      throw new Error(`GetProjects failed: ${JSON.stringify(projectsRes.errors)}`);
    }

    const projectList = projectsRes.data?.projects?.data;
    const meta = projectsRes.data?.projects?.meta;
    console.log(`   ✅ Paginated projects returned: ${projectList.length} item(s), totalItems: ${meta.totalItems}`);
    if (!projectList.some((p: any) => p.id === createdProjectId)) {
      throw new Error('Created project was not found in `projects` query results');
    }

    // Step 5: Test query project by ID
    console.log('\n5️⃣ Testing `project(id)` GraphQL Query...');
    const singleQuery = `
      query GetProject($id: ID!) {
        project(id: $id) {
          id
          name
          slug
          totalUsers
          totalConversations
        }
      }
    `;
    const singleRes = await graphqlPost(graphqlUrl, singleQuery, { id: createdProjectId }, adminToken);
    if (singleRes.errors) {
      throw new Error(`GetProject failed: ${JSON.stringify(singleRes.errors)}`);
    }
    console.log(`   ✅ Single project retrieved: ${singleRes.data?.project?.name} (Users: ${singleRes.data?.project?.totalUsers}, Convs: ${singleRes.data?.project?.totalConversations})`);

    // Step 6: Test query projectBySlug
    console.log('\n6️⃣ Testing `projectBySlug(slug)` GraphQL Query...');
    const slugQuery = `
      query GetProjectBySlug($slug: String!) {
        projectBySlug(slug: $slug) {
          id
          slug
          name
        }
      }
    `;
    const slugRes = await graphqlPost(graphqlUrl, slugQuery, { slug: testSlug }, adminToken);
    if (slugRes.errors) {
      throw new Error(`GetProjectBySlug failed: ${JSON.stringify(slugRes.errors)}`);
    }
    console.log(`   ✅ Project by slug retrieved: ${slugRes.data?.projectBySlug?.slug}`);

    // Step 7: Test updateProject mutation
    console.log('\n7️⃣ Testing `updateProject` GraphQL Mutation...');
    const updateMutation = `
      mutation UpdateProject($id: ID!, $input: UpdateProjectInput!) {
        updateProject(id: $id, input: $input) {
          id
          name
          status
        }
      }
    `;
    const updateRes = await graphqlPost(graphqlUrl, updateMutation, {
      id: createdProjectId,
      input: { name: 'GraphQL Test Project Updated' },
    }, adminToken);
    if (updateRes.errors) {
      throw new Error(`UpdateProject failed: ${JSON.stringify(updateRes.errors)}`);
    }
    console.log(`   ✅ Project updated: ${updateRes.data?.updateProject?.name}`);

    // Step 8: Test regenerateProjectKeys mutation
    console.log('\n8️⃣ Testing `regenerateProjectKeys` GraphQL Mutation...');
    const regenMutation = `
      mutation RegenerateKeys($id: ID!) {
        regenerateProjectKeys(id: $id) {
          id
          apiKey
          apiSecret
        }
      }
    `;
    const regenRes = await graphqlPost(graphqlUrl, regenMutation, { id: createdProjectId }, adminToken);
    if (regenRes.errors) {
      throw new Error(`RegenerateProjectKeys failed: ${JSON.stringify(regenRes.errors)}`);
    }
    const newApiKey = regenRes.data?.regenerateProjectKeys?.apiKey;
    console.log(`   ✅ Project API Keys regenerated: ${newApiKey.slice(0, 15)}... (different from old key: ${newApiKey !== created.apiKey})`);

    console.log('\n🎉 ALL GRAPHQL PROJECT OPERATIONS PASSED SUCCESSFULLY!');
  } finally {
    // Cleanup
    if (createdProjectId) {
      await prisma.project.delete({ where: { id: createdProjectId } }).catch(() => {});
    }
    if (adminUserId) {
      await prisma.user.delete({ where: { id: adminUserId } }).catch(() => {});
    }
    if (app) {
      await app.close();
    }
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runProjectGraphQLTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Test failed:', err);
      process.exit(1);
    });
}
