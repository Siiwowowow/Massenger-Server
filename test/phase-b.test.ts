import { PrismaClient, ConversationType, ParticipantRole } from '../src/generated/prisma';
import { ProjectService } from '../src/app/modules/project/project.service';
import { CommunicationUserService } from '../src/app/modules/communication-user/communication-user.service';
import { ConversationService } from '../src/app/modules/conversation/conversation.service';
import { PrismaService } from '../src/app/database/prisma.service';

export async function runPhaseBTests() {
  console.log('🧪 Starting Phase B Automated Verification: Conversation & Participants...\n');

  const prisma = new PrismaClient() as unknown as PrismaService;
  const projectService = new ProjectService(prisma);
  const commUserService = new CommunicationUserService(prisma);
  const conversationService = new ConversationService(prisma);

  const timestamp = Date.now();
  const slugAlpha = `test-b-alpha-${timestamp}`;
  const slugBeta = `test-b-beta-${timestamp}`;

  try {
    // 1. Setup Projects
    console.log('1️⃣ Setup: Creating test projects and communication users...');
    const projectAlpha = await projectService.create({
      name: 'Project Alpha (Phase B)',
      slug: slugAlpha,
    });
    const projectBeta = await projectService.create({
      name: 'Project Beta (Phase B)',
      slug: slugBeta,
    });

    const alpha1 = await commUserService.sync(projectAlpha.id, {
      externalId: `alpha_user_1_${timestamp}`,
      name: 'Alice Alpha',
      email: 'alice@alpha.test',
    });
    const alpha2 = await commUserService.sync(projectAlpha.id, {
      externalId: `alpha_user_2_${timestamp}`,
      name: 'Bob Alpha',
      email: 'bob@alpha.test',
    });
    const alpha3 = await commUserService.sync(projectAlpha.id, {
      externalId: `alpha_user_3_${timestamp}`,
      name: 'Charlie Alpha',
      email: 'charlie@alpha.test',
    });
    const alpha4 = await commUserService.sync(projectAlpha.id, {
      externalId: `alpha_user_4_${timestamp}`,
      name: 'Diana Alpha',
      email: 'diana@alpha.test',
    });

    const beta1 = await commUserService.sync(projectBeta.id, {
      externalId: `beta_user_1_${timestamp}`,
      name: 'Boris Beta',
      email: 'boris@beta.test',
    });

    console.log('   ✅ Projects and Users created successfully.\n');

    // 2. Direct Conversation Tests
    console.log('2️⃣ Testing Direct Conversations & Idempotency...');

    // Self conversation check
    try {
      await conversationService.createDirect(projectAlpha.id, alpha1.id, alpha1.id);
      throw new Error('❌ Self-conversation should have failed!');
    } catch (err: any) {
      if (err.message && err.message.includes('yourself')) {
        console.log('   ✅ Self-conversation prevented: Rejected with proper error.');
      } else {
        throw err;
      }
    }

    // Cross-project direct conversation attempt
    try {
      await conversationService.createDirect(projectAlpha.id, alpha1.id, beta1.id);
      throw new Error('❌ Cross-project direct conversation should have failed!');
    } catch (err: any) {
      if (err.message && err.message.includes('not found')) {
        console.log('   ✅ Cross-project user addition prevented: Target user from Beta not found in Alpha.');
      } else {
        throw err;
      }
    }

    // Create Direct Conversation: A -> B
    const directAtoB = await conversationService.createDirect(projectAlpha.id, alpha1.id, alpha2.id);
    if (directAtoB.type !== ConversationType.DIRECT || directAtoB.participants.length !== 2) {
      throw new Error('❌ Direct conversation creation failed!');
    }
    console.log(`   ✅ Direct conversation created: ID=${directAtoB.id}`);

    // Call A -> B again: verify same conversation returned
    const directRepeatAtoB = await conversationService.createDirect(projectAlpha.id, alpha1.id, alpha2.id);
    if (directRepeatAtoB.id !== directAtoB.id) {
      throw new Error('❌ Duplicate direct conversation created for identical participants!');
    }
    console.log('   ✅ A -> B idempotent duplicate prevention: Returned existing conversation.');

    // Call B -> A: verify same conversation returned
    const directBtoA = await conversationService.createDirect(projectAlpha.id, alpha2.id, alpha1.id);
    if (directBtoA.id !== directAtoB.id) {
      throw new Error('❌ Reverse B -> A failed to return existing direct conversation!');
    }
    console.log('   ✅ B -> A symmetry verified: Both directions resolve to the identical conversation.');

    // 3. Group Conversation Tests
    console.log('\n3️⃣ Testing Group Conversations & Roles...');

    // Attempt group creation with cross-project user
    try {
      await conversationService.createGroup(projectAlpha.id, alpha1.id, {
        title: 'Mixed Project Group',
        participantIds: [alpha2.id, beta1.id],
      });
      throw new Error('❌ Cross-project group creation should have failed!');
    } catch (err: any) {
      if (err.message && err.message.includes('invalid or belong to another project')) {
        console.log('   ✅ Cross-project group participant rejection verified.');
      } else {
        throw err;
      }
    }

    // Create Valid Group Conversation
    const groupConv = await conversationService.createGroup(projectAlpha.id, alpha1.id, {
      title: 'Alpha Engineering Team',
      participantIds: [alpha2.id, alpha3.id],
    });

    if (groupConv.type !== ConversationType.GROUP || groupConv.participants.length !== 3) {
      throw new Error('❌ Group conversation creation failed!');
    }

    const creatorParticipant = groupConv.participants.find((p) => p.userId === alpha1.id);
    const member2Participant = groupConv.participants.find((p) => p.userId === alpha2.id);
    const member3Participant = groupConv.participants.find((p) => p.userId === alpha3.id);

    if (creatorParticipant?.role !== ParticipantRole.ADMIN) {
      throw new Error('❌ Creator should be automatically designated as ADMIN!');
    }
    if (member2Participant?.role !== ParticipantRole.MEMBER || member3Participant?.role !== ParticipantRole.MEMBER) {
      throw new Error('❌ Other group participants should be designated as MEMBER!');
    }
    console.log('   ✅ Group created: Creator is ADMIN, other participants are MEMBER.');

    // 4. Participant Management Tests
    console.log('\n4️⃣ Testing Participant Management (Add, Duplicate, Remove)...');

    // Attempt to add participant to DIRECT conversation -> must fail
    try {
      await conversationService.addParticipant(projectAlpha.id, directAtoB.id, alpha1.id, {
        userId: alpha3.id,
      });
      throw new Error('❌ Adding participant to DIRECT conversation should have failed!');
    } catch (err: any) {
      if (err.message && err.message.includes('direct conversation')) {
        console.log('   ✅ Direct conversation protected: Cannot add participants to DIRECT conversation.');
      } else {
        throw err;
      }
    }

    // Non-admin (alpha2) attempts to add participant to group -> must fail
    try {
      await conversationService.addParticipant(projectAlpha.id, groupConv.id, alpha2.id, {
        userId: alpha4.id,
      });
      throw new Error('❌ Non-admin should not be allowed to add participants!');
    } catch (err: any) {
      if (err.message && err.message.includes('Only group admins')) {
        console.log('   ✅ Authorization check passed: Non-admin cannot add participants.');
      } else {
        throw err;
      }
    }

    // Admin (alpha1) adds alpha4
    const addedAlpha4 = await conversationService.addParticipant(projectAlpha.id, groupConv.id, alpha1.id, {
      userId: alpha4.id,
    });
    if (addedAlpha4.userId !== alpha4.id) {
      throw new Error('❌ Failed to add participant alpha4!');
    }
    console.log('   ✅ Admin successfully added participant to Group.');

    // Duplicate participant: Add alpha4 again -> must fail
    try {
      await conversationService.addParticipant(projectAlpha.id, groupConv.id, alpha1.id, {
        userId: alpha4.id,
      });
      throw new Error('❌ Adding duplicate participant should have failed!');
    } catch (err: any) {
      if (err.message && err.message.includes('already a participant')) {
        console.log('   ✅ Duplicate participant prevention verified.');
      } else {
        throw err;
      }
    }

    // Non-admin (alpha2) attempts to remove participant -> must fail
    try {
      await conversationService.removeParticipant(projectAlpha.id, groupConv.id, alpha2.id, alpha4.id);
      throw new Error('❌ Non-admin should not be allowed to remove participants!');
    } catch (err: any) {
      if (err.message && err.message.includes('Only group admins')) {
        console.log('   ✅ Authorization check passed: Non-admin cannot remove participants.');
      } else {
        throw err;
      }
    }

    // Admin removes alpha4
    await conversationService.removeParticipant(projectAlpha.id, groupConv.id, alpha1.id, alpha4.id);
    const participantsAfterRemoval = await conversationService.getParticipants(projectAlpha.id, groupConv.id, alpha1.id);
    if (participantsAfterRemoval.some((p) => p.userId === alpha4.id)) {
      throw new Error('❌ alpha4 was not removed!');
    }
    console.log('   ✅ Admin successfully removed participant from Group.');

    // 5. Authorization & Project Isolation Checks
    console.log('\n5️⃣ Testing Authorization & Project Boundary Isolation...');

    // isParticipant helper checks
    const isAlpha1InGroup = await conversationService.isParticipant(groupConv.id, alpha1.id, projectAlpha.id);
    const isBeta1InAlphaGroup = await conversationService.isParticipant(groupConv.id, beta1.id, projectAlpha.id);
    const isAlpha1InBetaGroup = await conversationService.isParticipant(groupConv.id, alpha1.id, projectBeta.id);

    if (!isAlpha1InGroup || isBeta1InAlphaGroup || isAlpha1InBetaGroup) {
      throw new Error('❌ isParticipant membership verification failed!');
    }
    console.log('   ✅ isParticipant project-scoped helper verified.');

    // Non-member access check
    try {
      await conversationService.findById(projectAlpha.id, groupConv.id, alpha4.id);
      throw new Error('❌ Non-member should have been denied access!');
    } catch (err: any) {
      if (err.message && err.message.includes('not a member')) {
        console.log('   ✅ Non-member access denied: 403 Forbidden received.');
      } else {
        throw err;
      }
    }

    // Cross-project conversation access check
    try {
      await conversationService.findById(projectBeta.id, groupConv.id, beta1.id);
      throw new Error('❌ Cross-project conversation access should have been denied!');
    } catch (err: any) {
      if (err.message && err.message.includes('not found')) {
        console.log('   ✅ Cross-project isolation verified: Group conversation inaccessible from Beta context.');
      } else {
        throw err;
      }
    }

    // 6. User Conversations List
    console.log('\n6️⃣ Testing User Conversations Listing...');
    const alpha1Conversations = await conversationService.findUserConversations(projectAlpha.id, alpha1.id, {
      page: 1,
      limit: 10,
    });
    if (alpha1Conversations.data.length < 2) {
      throw new Error('❌ Expected alpha1 to have at least 2 conversations (1 direct, 1 group)!');
    }
    console.log(`   ✅ User conversations retrieved: alpha1 has ${alpha1Conversations.data.length} conversations.`);

    const beta1Conversations = await conversationService.findUserConversations(projectBeta.id, beta1.id, {
      page: 1,
      limit: 10,
    });
    if (beta1Conversations.data.length !== 0) {
      throw new Error('❌ Expected beta1 to have 0 conversations in Beta project!');
    }
    console.log('   ✅ Zero conversation leakage across project boundaries verified.');

    // 7. Leave Group & Sole Admin Auto-Promotion
    console.log('\n7️⃣ Testing Leave Conversation & Sole Admin Safeguard...');

    // Alpha3 leaves group
    await conversationService.leaveConversation(projectAlpha.id, groupConv.id, alpha3.id);
    const afterAlpha3Leave = await conversationService.getParticipants(projectAlpha.id, groupConv.id, alpha1.id);
    if (afterAlpha3Leave.some((p) => p.userId === alpha3.id)) {
      throw new Error('❌ alpha3 should not be in participants after leaving!');
    }
    console.log('   ✅ Member (alpha3) successfully left group conversation.');

    // Now group has: alpha1 (ADMIN) and alpha2 (MEMBER).
    // When alpha1 (sole admin) leaves: verify alpha2 is auto-promoted to ADMIN!
    await conversationService.leaveConversation(projectAlpha.id, groupConv.id, alpha1.id);
    const afterSoleAdminLeave = await conversationService.getParticipants(projectAlpha.id, groupConv.id, alpha2.id);

    const remainingParticipant = afterSoleAdminLeave.find((p) => p.userId === alpha2.id);
    if (remainingParticipant?.role !== ParticipantRole.ADMIN) {
      throw new Error('❌ alpha2 should have been auto-promoted to ADMIN after sole admin left!');
    }
    console.log('   ✅ Sole Admin safeguard verified: Oldest remaining member auto-promoted to ADMIN.');

    // Direct conversation leave check (keeps record intact)
    const directLeaveResult = await conversationService.leaveConversation(projectAlpha.id, directAtoB.id, alpha1.id);
    const directStillExists = await conversationService.findById(projectAlpha.id, directAtoB.id, alpha2.id);
    if (!directStillExists) {
      throw new Error('❌ Direct conversation should remain intact when a participant leaves!');
    }
    console.log(`   ✅ Direct conversation leave verified: ${directLeaveResult.message}, record preserved.`);

    // 8. Cleanup
    console.log('\n🧹 Cleaning up test artifacts...');
    await prisma.conversationParticipant.deleteMany({
      where: {
        conversationId: { in: [directAtoB.id, groupConv.id] },
      },
    });
    await prisma.conversation.deleteMany({
      where: {
        id: { in: [directAtoB.id, groupConv.id] },
      },
    });
    await prisma.communicationUser.deleteMany({
      where: {
        id: { in: [alpha1.id, alpha2.id, alpha3.id, alpha4.id, beta1.id] },
      },
    });
    await prisma.project.deleteMany({
      where: {
        id: { in: [projectAlpha.id, projectBeta.id] },
      },
    });
    console.log('   ✅ Test artifacts successfully cleaned up.\n');

    console.log('🎉 ALL PHASE B VERIFICATION CHECKS PASSED SUCCESSFULLY!');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runPhaseBTests().catch((err) => {
    console.error('❌ Phase B verification failed:', err);
    process.exit(1);
  });
}
