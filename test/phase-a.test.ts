import { PrismaClient } from '../src/generated/prisma';
import { ProjectService } from '../src/app/modules/project/project.service';
import { CommunicationUserService } from '../src/app/modules/communication-user/communication-user.service';
import { PrismaService } from '../src/app/database/prisma.service';

export async function runPhaseATests() {
  console.log('🧪 Starting Phase A Automated Verification...\n');

  const prisma = new PrismaClient() as unknown as PrismaService;
  const projectService = new ProjectService(prisma);
  const commUserService = new CommunicationUserService(prisma);

  const timestamp = Date.now();
  const slugAlpha = `test-alpha-${timestamp}`;
  const slugBeta = `test-beta-${timestamp}`;

  try {
    // 1. Create Project Alpha
    console.log('1️⃣ Testing Project Creation...');
    const projectAlpha = await projectService.create({
      name: 'Test Project Alpha',
      slug: slugAlpha,
    });
    console.log(`   ✅ Project Alpha created: ID=${projectAlpha.id}, ApiKey=${projectAlpha.apiKey.slice(0, 15)}...`);

    // 2. Create Project Beta
    const projectBeta = await projectService.create({
      name: 'Test Project Beta',
      slug: slugBeta,
    });
    console.log(`   ✅ Project Beta created: ID=${projectBeta.id}, ApiKey=${projectBeta.apiKey.slice(0, 15)}...`);

    // 3. Sync same externalId across both projects
    console.log('\n2️⃣ Testing Communication User Sync & Multi-Tenant Isolation...');
    const externalId = `ext_user_${timestamp}`;

    const userAlpha = await commUserService.sync(projectAlpha.id, {
      externalId,
      name: 'Dr. John Doe (Alpha)',
      email: 'john.doe@alpha.hospital',
      avatar: 'https://example.com/alpha.jpg',
    });
    console.log(`   ✅ User synced in Project Alpha: internalId=${userAlpha.id}, externalId=${userAlpha.externalId}`);

    const userBeta = await commUserService.sync(projectBeta.id, {
      externalId,
      name: 'Buyer John (Beta)',
      email: 'john@beta.shop',
      avatar: 'https://example.com/beta.jpg',
    });
    console.log(`   ✅ User synced in Project Beta with SAME externalId: internalId=${userBeta.id}, externalId=${userBeta.externalId}`);

    if (userAlpha.id === userBeta.id) {
      throw new Error('❌ Isolation failure: userAlpha and userBeta must have distinct internal IDs!');
    }
    console.log('   ✅ Multi-tenant isolation verified: Distinct records created for identical externalIds in different projects.');

    // 4. Update sync in Project Alpha
    const updatedAlpha = await commUserService.sync(projectAlpha.id, {
      externalId,
      name: 'Dr. John Doe MD (Updated)',
      email: 'john.doe@alpha.hospital',
      avatar: 'https://example.com/alpha-updated.jpg',
    });
    if (updatedAlpha.name !== 'Dr. John Doe MD (Updated)' || updatedAlpha.id !== userAlpha.id) {
      throw new Error('❌ Upsert update failed for Project Alpha user!');
    }
    console.log('   ✅ Idempotent upsert verified: Existing user updated properly without duplicate creation.');

    // 5. Query Project Alpha user from Project Beta context (Cross-project access check)
    console.log('\n3️⃣ Testing Cross-Project Isolation Access Checks...');
    try {
      await commUserService.findById(projectBeta.id, userAlpha.id);
      throw new Error('❌ Security breach: Project Beta should NOT be able to find Project Alpha user!');
    } catch (err: any) {
      if (err.message && err.message.includes('not found')) {
        console.log('   ✅ Cross-project isolation verified: Finding Alpha user with Beta project context returned 404 Not Found.');
      } else {
        throw err;
      }
    }

    // 6. Test Listing Users Scoped by Project
    console.log('\n4️⃣ Testing Scoped User Listing...');
    const listAlpha = await commUserService.findAll(projectAlpha.id, { page: 1, limit: 10 });
    const hasBetaUserInAlpha = listAlpha.data.some((u) => u.id === userBeta.id);
    if (hasBetaUserInAlpha) {
      throw new Error('❌ Project Alpha user list contains Project Beta users!');
    }
    console.log(`   ✅ User listing verified: Project Alpha returned ${listAlpha.data.length} users, zero leakage from Beta.`);

    // 7. Test Presence Update
    console.log('\n5️⃣ Testing Presence Status Updates...');
    const onlineUser = await commUserService.updateOnlineStatus(userAlpha.id, true);
    if (!onlineUser.isOnline) {
      throw new Error('❌ Expected isOnline to be true!');
    }
    const offlineUser = await commUserService.updateOnlineStatus(userAlpha.id, false);
    if (offlineUser.isOnline || !offlineUser.lastSeenAt) {
      throw new Error('❌ Expected isOnline to be false and lastSeenAt to be set!');
    }
    console.log('   ✅ Presence status verified: isOnline toggles and records lastSeenAt timestamp.');

    // 8. Cleanup test data
    console.log('\n🧹 Cleaning up test artifacts...');
    await prisma.communicationUser.deleteMany({
      where: {
        id: { in: [userAlpha.id, userBeta.id] },
      },
    });
    await prisma.project.deleteMany({
      where: {
        id: { in: [projectAlpha.id, projectBeta.id] },
      },
    });
    console.log('   ✅ Test projects and communication users cleaned up.\n');

    console.log('🎉 ALL PHASE A VERIFICATION CHECKS PASSED SUCCESSFULLY!');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runPhaseATests().catch((err) => {
    console.error('❌ Phase A verification failed:', err);
    process.exit(1);
  });
}
