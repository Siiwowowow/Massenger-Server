import { PrismaClient } from '../src/generated/prisma';
import { ProjectService } from '../src/app/modules/project/project.service';
import { CommunicationUserService } from '../src/app/modules/communication-user/communication-user.service';
import { ConversationService } from '../src/app/modules/conversation/conversation.service';
import { LiveKitService } from '../src/app/modules/call/livekit.service';
import { CallService } from '../src/app/modules/call/call.service';
import { PrismaService } from '../src/app/database/prisma.service';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';

export async function runCallPhase1Tests() {
  console.log('🧪 Starting Call Phase 1 Automated Verification: LiveKit Infrastructure & Token Service...\n');

  const prisma = new PrismaClient() as unknown as PrismaService;
  const projectService = new ProjectService(prisma);
  const commUserService = new CommunicationUserService(prisma);
  const conversationService = new ConversationService(prisma);
  const configService = new ConfigService();
  const livekitService = new LiveKitService(configService);
  const callService = new CallService(conversationService, livekitService);

  const timestamp = Date.now();
  const slugAlpha = `test-call-alpha-${timestamp}`;
  const slugBeta = `test-call-beta-${timestamp}`;

  try {
    // =========================================================================
    // 1. CONFIGURATION TESTS
    // =========================================================================
    console.log('1️⃣ Testing LiveKit Configuration & Service Initialization...');
    
    livekitService.validateConfig();
    const serverUrl = livekitService.getServerUrl();
    if (!serverUrl || !serverUrl.startsWith('ws://') && !serverUrl.startsWith('wss://')) {
      throw new Error(`❌ Invalid server URL returned: ${serverUrl}`);
    }
    console.log(`   ✅ LiveKit configuration loaded successfully. Server URL: ${serverUrl}`);

    // Verify room naming is deterministic, opaque, and contains no PII
    const sampleId = '507f1f77bcf86cd799439011';
    const roomName = livekitService.generateRoomName(sampleId);
    if (roomName !== `call_${sampleId}`) {
      throw new Error(`❌ Expected room name call_${sampleId}, got ${roomName}`);
    }
    if (roomName.includes('@') || roomName.includes('john') || roomName.includes('external')) {
      throw new Error('❌ Room name leaks personal identity information!');
    }
    console.log(`   ✅ Deterministic, opaque room naming verified: ${roomName}`);

    // =========================================================================
    // 2. SETUP TEST PROJECTS, USERS, AND CONVERSATIONS
    // =========================================================================
    console.log('\n2️⃣ Setting up multi-tenant test fixtures...');
    
    // Project Alpha
    const projectAlpha = await projectService.create({
      name: 'Project Alpha (Calling)',
      slug: slugAlpha,
    });
    // Project Beta
    const projectBeta = await projectService.create({
      name: 'Project Beta (Calling)',
      slug: slugBeta,
    });

    // Users in Project Alpha
    const userAlpha1 = await commUserService.sync(projectAlpha.id, {
      externalId: `user_alpha_1_${timestamp}`,
      name: 'Alice Alpha',
      email: 'alice@alpha.calling',
    });
    const userAlpha2 = await commUserService.sync(projectAlpha.id, {
      externalId: `user_alpha_2_${timestamp}`,
      name: 'Bob Alpha',
      email: 'bob@alpha.calling',
    });
    const userAlphaNonMember = await commUserService.sync(projectAlpha.id, {
      externalId: `user_alpha_outsider_${timestamp}`,
      name: 'Charlie Outsider',
      email: 'charlie@alpha.calling',
    });

    // User in Project Beta
    const userBeta1 = await commUserService.sync(projectBeta.id, {
      externalId: `user_beta_1_${timestamp}`,
      name: 'Boris Beta',
      email: 'boris@beta.calling',
    });
    const userBeta2 = await commUserService.sync(projectBeta.id, {
      externalId: `user_beta_2_${timestamp}`,
      name: 'Betty Beta',
      email: 'betty@beta.calling',
    });

    // Conversations
    const convAlpha = await conversationService.createDirect(
      projectAlpha.id,
      userAlpha1.id,
      userAlpha2.id,
    );
    const convBeta = await conversationService.createDirect(
      projectBeta.id,
      userBeta1.id,
      userBeta2.id,
    );

    console.log(`   ✅ Test projects, users, and conversations initialized:`);
    console.log(`      - Project Alpha: ${projectAlpha.id}, Conv: ${convAlpha.id} (Alice & Bob)`);
    console.log(`      - Project Beta:  ${projectBeta.id}, Conv: ${convBeta.id} (Boris & Betty)`);

    // =========================================================================
    // 3. TOKEN GENERATION FOR VALID MEMBER
    // =========================================================================
    console.log('\n3️⃣ Testing LiveKit Token Generation for Valid Participant...');

    const tokenResult = await callService.generateToken(
      projectAlpha.id,
      userAlpha1,
      convAlpha.id,
    );

    if (!tokenResult.token || typeof tokenResult.token !== 'string' || tokenResult.token.length < 20) {
      throw new Error('❌ Generated token is missing or too short');
    }
    if (tokenResult.serverUrl !== serverUrl) {
      throw new Error(`❌ Token result serverUrl mismatch: expected ${serverUrl}, got ${tokenResult.serverUrl}`);
    }
    if (tokenResult.roomName !== `call_${convAlpha.id}`) {
      throw new Error(`❌ Token result roomName mismatch: expected call_${convAlpha.id}, got ${tokenResult.roomName}`);
    }

    console.log(`   ✅ Token generated: length=${tokenResult.token.length}, room=${tokenResult.roomName}`);

    // Decode token claims without exposing secret
    const decoded = jwt.decode(tokenResult.token) as any;
    if (!decoded) {
      throw new Error('❌ Failed to decode token JWT payload');
    }

    // Verify token claims & permissions
    const participantIdentity = decoded.sub || decoded.identity;
    if (participantIdentity !== userAlpha1.id) {
      throw new Error(`❌ Token identity mismatch: expected ${userAlpha1.id}, got ${participantIdentity}`);
    }
    if (!decoded.video || decoded.video.room !== `call_${convAlpha.id}`) {
      throw new Error(`❌ Token room grant mismatch: expected call_${convAlpha.id}`);
    }
    if (decoded.video.roomJoin !== true) {
      throw new Error('❌ Token must grant roomJoin permission');
    }
    if (decoded.video.canPublish !== true || decoded.video.canSubscribe !== true) {
      throw new Error('❌ Token must grant canPublish and canSubscribe for 1-to-1 calling');
    }
    if (decoded.video.roomAdmin === true || decoded.video.roomRecord === true) {
      throw new Error('❌ Security violation: participant token must NOT grant admin or record privileges');
    }

    console.log('   ✅ Token claims verified: Identity, room grants, and non-admin restrictions confirmed.');

    // =========================================================================
    // 4. AUTHORIZATION TESTS
    // =========================================================================
    console.log('\n4️⃣ Testing Authorization & Multi-Tenant Isolation Checks...');

    // 4.1 Non-member rejection (User Alpha Outsider trying to access Alice & Bob's conversation)
    try {
      await callService.generateToken(projectAlpha.id, userAlphaNonMember, convAlpha.id);
      throw new Error('❌ Security breach: Non-member was able to generate call token!');
    } catch (err: any) {
      if (err.message && err.message.toLowerCase().includes('not a member')) {
        console.log('   ✅ Non-member correctly rejected with ForbiddenException.');
      } else {
        throw err;
      }
    }

    // 4.2 Cross-project access rejection (User Beta trying to access Alpha's conversation)
    try {
      await callService.generateToken(projectBeta.id, userBeta1, convAlpha.id);
      throw new Error('❌ Security breach: Cross-project conversation access succeeded!');
    } catch (err: any) {
      if (err.message && (err.message.toLowerCase().includes('not found') || err.status === 404)) {
        console.log('   ✅ Cross-project conversation access rejected with NotFoundException.');
      } else {
        throw err;
      }
    }

    // 4.3 Nonexistent conversation rejection
    try {
      const nonexistentId = '507f1f77bcf86cd799439099';
      await callService.generateToken(projectAlpha.id, userAlpha1, nonexistentId);
      throw new Error('❌ Security breach: Token generated for non-existent conversation!');
    } catch (err: any) {
      if (err.message && (err.message.toLowerCase().includes('not found') || err.status === 404)) {
        console.log('   ✅ Non-existent conversation correctly rejected with NotFoundException.');
      } else {
        throw err;
      }
    }

    // 4.4 Malformed conversation ID rejection
    try {
      await callService.generateToken(projectAlpha.id, userAlpha1, 'malformed-conv-id');
      throw new Error('❌ Malformed conversation ID should have been rejected!');
    } catch (err: any) {
      if (err.message && (err.message.toLowerCase().includes('not found') || err.status === 404)) {
        console.log('   ✅ Malformed conversation ID rejected with NotFoundException.');
      } else {
        throw err;
      }
    }

    // =========================================================================
    // 5. SECURITY AUDIT
    // =========================================================================
    console.log('\n5️⃣ Testing Security & Secret Leakage Prevention...');

    const serializedResponse = JSON.stringify(tokenResult);
    const apiSecret = process.env.LIVEKIT_API_SECRET || 'secret';
    const apiKey = process.env.LIVEKIT_API_KEY || 'devkey';

    if (serializedResponse.includes(apiSecret)) {
      throw new Error('❌ CRITICAL SECURITY FLAW: LIVEKIT_API_SECRET leaked in token response!');
    }
    if (serializedResponse.includes(`"apiKey":"${apiKey}"`)) {
      throw new Error('❌ LIVEKIT_API_KEY leaked in token response payload!');
    }
    console.log('   ✅ Verified: LIVEKIT_API_SECRET is completely absent from API response payload.');

    // Verify token payload does not leak secret
    if (JSON.stringify(decoded).includes(apiSecret)) {
      throw new Error('❌ CRITICAL SECURITY FLAW: LIVEKIT_API_SECRET leaked inside JWT body!');
    }
    console.log('   ✅ Verified: LIVEKIT_API_SECRET is completely absent from token claims.');

    // =========================================================================
    // 6. CLEANUP
    // =========================================================================
    console.log('\n🧹 Cleaning up test artifacts...');
    await prisma.conversationParticipant.deleteMany({
      where: {
        conversationId: { in: [convAlpha.id, convBeta.id] },
      },
    });
    await prisma.conversation.deleteMany({
      where: {
        id: { in: [convAlpha.id, convBeta.id] },
      },
    });
    await prisma.communicationUser.deleteMany({
      where: {
        id: { in: [userAlpha1.id, userAlpha2.id, userAlphaNonMember.id, userBeta1.id, userBeta2.id] },
      },
    });
    await prisma.project.deleteMany({
      where: {
        id: { in: [projectAlpha.id, projectBeta.id] },
      },
    });
    console.log('   ✅ All test projects, conversations, and communication users deleted.\n');

    console.log('🎉 ALL CALL PHASE 1 VERIFICATION CHECKS PASSED SUCCESSFULLY!');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runCallPhase1Tests().catch((err) => {
    console.error('❌ Call Phase 1 verification failed:', err);
    process.exit(1);
  });
}
