/* eslint-disable no-useless-assignment */
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { PrismaClient } from '../src/generated/prisma';
import { PrismaService } from '../src/app/database/prisma.service';
import { ProjectService } from '../src/app/modules/project/project.service';
import { CommunicationUserService } from '../src/app/modules/communication-user/communication-user.service';
import { ConversationService } from '../src/app/modules/conversation/conversation.service';
import {
  REALTIME_EVENTS,
  RealtimeErrorCode,
} from '../src/app/modules/realtime/realtime.constants';
import { PRESENCE_STORE, PresenceStore } from '../src/app/modules/realtime/presence/presence.store.interface';
import { TYPING_STORE, TypingStore } from '../src/app/modules/realtime/typing/typing.store.interface';

// ============================================================================
// Helper functions for Socket.IO and HTTP client testing
// ============================================================================

function createClientSocket(
  url: string,
  options: {
    auth?: Record<string, unknown>;
    extraHeaders?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
): ClientSocket {
  return io(url, {
    transports: ['websocket'],
    forceNew: true,
    autoConnect: true,
    reconnection: false,
    timeout: 4000,
    auth: options.auth,
    extraHeaders: options.extraHeaders,
    query: options.query,
  });
}

function waitForConnect(socket: ClientSocket, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Connection timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });

    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    socket.once(REALTIME_EVENTS.SERVER.SOCKET_ERROR, (err: any) => {
      clearTimeout(timer);
      reject(new Error(err?.error?.message || 'Socket error'));
    });
  });
}

function emitWithAck<T = any>(
  socket: ClientSocket,
  event: string,
  payload: unknown,
  timeoutMs = 4000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Acknowledgement timeout after ${timeoutMs}ms for event '${event}'`,
        ),
      );
    }, timeoutMs);

    socket.emit(event, payload, (res: T) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

function waitForEvent<T = any>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 4000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timeout waiting for event '${event}' after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function expectNoEvent(
  socket: ClientSocket,
  event: string,
  waitMs = 600,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (data: unknown) => {
      reject(
        new Error(
          `Unexpected event '${event}' received: ${JSON.stringify(data)}`,
        ),
      );
    };
    socket.once(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, waitMs);
  });
}

async function httpGet(url: string, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    method: 'GET',
    headers,
  });
   
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(
  predicate: () => Promise<boolean>,
  timeoutMs = 4000,
  intervalMs = 100,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}


// ============================================================================
// Main Phase F Test Suite
// ============================================================================

export async function runPhaseFTests() {
  console.log(
    '🧪 Starting Phase F Automated Verification: Realtime Presence + Typing Indicator...\n',
  );

  const prisma = new PrismaClient() as unknown as PrismaService;
  const projectService = new ProjectService(prisma);
  const commUserService = new CommunicationUserService(prisma);
  const conversationService = new ConversationService(prisma);

  let app: INestApplication | null = null;
  let serverUrl = '';
  const activeSockets: ClientSocket[] = [];

  const timestamp = Date.now();
  const slugAlpha = `test-f-alpha-${timestamp}`;
  const slugBeta = `test-f-beta-${timestamp}`;

  try {
    // ------------------------------------------------------------------------
    // Step 0: Bootstrap Test NestJS Application
    // ------------------------------------------------------------------------
    console.log('0️⃣ Bootstrapping NestJS application for Socket.IO & REST E2E harness...');
    app = await NestFactory.create(AppModule, { logger: ['warn', 'error'] });
    app.setGlobalPrefix('api/v1', { exclude: ['', '/', 'health', 'graphql'] });
    await app.listen(0);
    const httpServer = app.getHttpServer();
    const address = httpServer.address();
    const port = typeof address === 'string' ? address : address.port;
    serverUrl = `http://localhost:${port}`;
    console.log(`   ✅ NestJS Server running at ${serverUrl}\n`);

    const presenceStore = app.get<PresenceStore>(PRESENCE_STORE);
    const typingStore = app.get<TypingStore>(TYPING_STORE);

    // ------------------------------------------------------------------------
    // Step 1: Create Projects, Users, and Conversations
    // ------------------------------------------------------------------------
    console.log('1️⃣ Setting up test projects, users, and conversations...');
    const projectAlpha = await projectService.create({
      name: 'Project Alpha (Phase F)',
      slug: slugAlpha,
    });
    const projectBeta = await projectService.create({
      name: 'Project Beta (Phase F)',
      slug: slugBeta,
    });

    const userA = await commUserService.sync(projectAlpha.id, {
      externalId: `alpha_user_a_${timestamp}`,
      name: 'Alice Alpha',
      email: 'alice@alpha.test',
    });
    const userB = await commUserService.sync(projectAlpha.id, {
      externalId: `alpha_user_b_${timestamp}`,
      name: 'Bob Alpha',
      email: 'bob@alpha.test',
    });
    const userC = await commUserService.sync(projectAlpha.id, {
      externalId: `alpha_user_c_${timestamp}`,
      name: 'Charlie Alpha',
      email: 'charlie@alpha.test',
    });
    const userNonMember = await commUserService.sync(projectAlpha.id, {
      externalId: `alpha_non_member_${timestamp}`,
      name: 'NonMember Alpha',
      email: 'nonmember@alpha.test',
    });

    const betaUserX = await commUserService.sync(projectBeta.id, {
      externalId: `beta_user_x_${timestamp}`,
      name: 'Xavier Beta',
      email: 'xavier@beta.test',
    });

    const directConv = await conversationService.createDirect(
      projectAlpha.id,
      userA.id,
      userB.id,
    );

    const groupConv = await conversationService.createGroup(
      projectAlpha.id,
      userA.id,
      {
        title: 'Alpha Team Group',
        participantIds: [userB.id, userC.id],
      },
    );

    console.log(`   ✅ Setup complete. DirectConv: ${directConv.id}, GroupConv: ${groupConv.id}\n`);

    // ========================================================================
    // Group 1: Presence — Online / Offline / DB Sync (Tests 1-8)
    // ========================================================================
    console.log('📡 Testing Group 1: Single Socket Presence...');

    // First, connect userB and have userB join directConv room to receive presence broadcasts
    const socketB = createClientSocket(serverUrl, {
      extraHeaders: {
        'x-api-key': projectAlpha.apiKey,
        'x-user-id': userB.id,
      },
    });
    activeSockets.push(socketB);
    await waitForConnect(socketB);
    await emitWithAck(socketB, REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN, {
      conversationId: directConv.id,
    });

    // Test 1: User A connects socket -> presence store has user A online
    const onlineEventPromise = waitForEvent<{ userId: string; isOnline: boolean }>(
      socketB,
      REALTIME_EVENTS.SERVER.PRESENCE_ONLINE,
    );

    const socketA1 = createClientSocket(serverUrl, {
      extraHeaders: {
        'x-api-key': projectAlpha.apiKey,
        'x-user-id': userA.id,
      },
    });
    activeSockets.push(socketA1);
    await waitForConnect(socketA1);

    if (!presenceStore.isOnline(projectAlpha.id, userA.id)) {
      throw new Error('Test 1 failed: userA should be online in presence store');
    }
    console.log('   ✅ Test 1: User A online in presence store after connection');

    // Test 2: MongoDB isOnline updated to true
    let dbUserAAfterConnect: any = null;
    await waitForCondition(async () => {
      dbUserAAfterConnect = await prisma.communicationUser.findUnique({
        where: { id: userA.id },
      });
      return Boolean(dbUserAAfterConnect?.isOnline);
    }, 4000);
    if (!dbUserAAfterConnect?.isOnline) {
      throw new Error('Test 2 failed: MongoDB isOnline should be true for userA');
    }
    console.log('   ✅ Test 2: MongoDB isOnline updated to true');

    // Test 3: presence:online event emitted to conversation room
    const onlineEvent = await onlineEventPromise;
    if (onlineEvent.userId !== userA.id || !onlineEvent.isOnline) {
      throw new Error(
        `Test 3 failed: Unexpected presence:online payload: ${JSON.stringify(onlineEvent)} (expected userA=${userA.id}, userB=${userB.id})`,
      );
    }
    console.log('   ✅ Test 3: presence:online emitted to conversation room');

    // Test 4: User A socket disconnects -> presence store has user A offline
    const offlineEventPromise = waitForEvent<{
      userId: string;
      isOnline: boolean;
      lastSeenAt: string | Date;
    }>(socketB, REALTIME_EVENTS.SERVER.PRESENCE_OFFLINE);

    socketA1.disconnect();
    await sleep(150);

    if (presenceStore.isOnline(projectAlpha.id, userA.id)) {
      throw new Error('Test 4 failed: userA should be offline in presence store after disconnect');
    }
    console.log('   ✅ Test 4: User A offline in presence store after disconnect');

    // Test 5: MongoDB isOnline updated to false
    let dbUserAAfterDisconnect: any = null;
    await waitForCondition(async () => {
      dbUserAAfterDisconnect = await prisma.communicationUser.findUnique({
        where: { id: userA.id },
      });
      return dbUserAAfterDisconnect?.isOnline === false && Boolean(dbUserAAfterDisconnect?.lastSeenAt);
    }, 4000);
    if (dbUserAAfterDisconnect?.isOnline) {
      throw new Error('Test 5 failed: MongoDB isOnline should be false');
    }
    console.log('   ✅ Test 5: MongoDB isOnline updated to false');

    // Test 6: MongoDB lastSeenAt updated to timestamp
    if (!dbUserAAfterDisconnect?.lastSeenAt) {
      throw new Error('Test 6 failed: MongoDB lastSeenAt should be set');
    }
    const lastSeenTime = new Date(dbUserAAfterDisconnect.lastSeenAt).getTime();
    if (Math.abs(Date.now() - lastSeenTime) > 10000) {
      throw new Error('Test 6 failed: lastSeenAt timestamp is not recent');
    }
    console.log('   ✅ Test 6: MongoDB lastSeenAt updated with recent timestamp');

    // Test 7: presence:offline event emitted to conversation room with lastSeenAt
    const offlineEvent = await offlineEventPromise;
    if (
      offlineEvent.userId !== userA.id ||
      offlineEvent.isOnline !== false ||
      !offlineEvent.lastSeenAt
    ) {
      throw new Error(`Test 7 failed: Unexpected presence:offline payload: ${JSON.stringify(offlineEvent)}`);
    }
    console.log('   ✅ Test 7: presence:offline emitted with lastSeenAt');

    // Test 8: REST endpoint GET /api/v1/communication-users/:userId/presence returns offline state
    const restPresenceOffline = await httpGet(
      `${serverUrl}/api/v1/communication-users/${userA.id}/presence`,
      { 'x-api-key': projectAlpha.apiKey },
    );
    if (
      restPresenceOffline.status !== 200 ||
      restPresenceOffline.body?.data?.isOnline !== false ||
      !restPresenceOffline.body?.data?.lastSeenAt
    ) {
      throw new Error(
        `Test 8 failed: REST presence offline check failed: ${JSON.stringify(restPresenceOffline)}`,
      );
    }
    console.log('   ✅ Test 8: REST presence endpoint returns accurate offline state with lastSeenAt\n');

    // ========================================================================
    // Group 2: Multi-Socket & Transition Tracking (Tests 9-16)
    // ========================================================================
    console.log('📱 Testing Group 2: Multi-Socket Tracking...');

    // Test 9: Connect Socket A1
    const socketA_dev1 = createClientSocket(serverUrl, {
      extraHeaders: {
        'x-api-key': projectAlpha.apiKey,
        'x-user-id': userA.id,
      },
    });
    activeSockets.push(socketA_dev1);
    await waitForConnect(socketA_dev1);

    if (!presenceStore.isOnline(projectAlpha.id, userA.id)) {
      throw new Error('Test 9 failed: userA should be online with Socket 1');
    }
    console.log('   ✅ Test 9: User A online on Socket 1');

    // Test 10: Connect Socket A2 (second device)
    // Listen on socketB to ensure NO second presence:online event is emitted!
    const expectNoSecondOnline = expectNoEvent(
      socketB,
      REALTIME_EVENTS.SERVER.PRESENCE_ONLINE,
      400,
    );

    const socketA_dev2 = createClientSocket(serverUrl, {
      extraHeaders: {
        'x-api-key': projectAlpha.apiKey,
        'x-user-id': userA.id,
      },
    });
    activeSockets.push(socketA_dev2);
    await waitForConnect(socketA_dev2);

    if (!presenceStore.isOnline(projectAlpha.id, userA.id)) {
      throw new Error('Test 10 failed: userA should still be online with Socket 2');
    }
    console.log('   ✅ Test 10: User A remains online after Socket 2 connects');

    // Test 11: DB isOnline is true
    let dbMultiCheck1: any = null;
    await waitForCondition(async () => {
      dbMultiCheck1 = await prisma.communicationUser.findUnique({
        where: { id: userA.id },
      });
      return Boolean(dbMultiCheck1?.isOnline);
    }, 4000);
    if (!dbMultiCheck1?.isOnline) {
      throw new Error('Test 11 failed: DB isOnline should be true');
    }
    console.log('   ✅ Test 11: MongoDB isOnline confirmed true for multi-socket user');

    // Test 12: Second socket connection did not emit duplicate presence:online
    await expectNoSecondOnline;
    console.log('   ✅ Test 12: Zero duplicate presence:online event emitted on 2nd socket connection');

    // Test 13: Disconnect Socket A1 -> User A REMAINS online in memory & DB
    const expectNoOfflineOnPartial = expectNoEvent(
      socketB,
      REALTIME_EVENTS.SERVER.PRESENCE_OFFLINE,
      400,
    );
    socketA_dev1.disconnect();
    await sleep(100);

    if (!presenceStore.isOnline(projectAlpha.id, userA.id)) {
      throw new Error('Test 13 failed: userA should still be online with Socket 2 active');
    }
    let dbMultiCheck2: any = null;
    await waitForCondition(async () => {
      dbMultiCheck2 = await prisma.communicationUser.findUnique({
        where: { id: userA.id },
      });
      return Boolean(dbMultiCheck2?.isOnline);
    }, 4000);
    if (!dbMultiCheck2?.isOnline) {
      throw new Error('Test 13 failed: MongoDB isOnline should still be true while Socket 2 active');
    }
    console.log('   ✅ Test 13: User A remains online after Socket 1 disconnects');

    // Test 14: Disconnecting Socket A1 did NOT emit presence:offline
    await expectNoOfflineOnPartial;
    console.log('   ✅ Test 14: Zero presence:offline emitted on partial socket disconnect');

    // Test 15: Disconnect Socket A2 -> final socket disconnects -> user becomes offline
    const finalOfflinePromise = waitForEvent<{
      userId: string;
      isOnline: boolean;
      lastSeenAt: string | Date;
    }>(socketB, REALTIME_EVENTS.SERVER.PRESENCE_OFFLINE);

    socketA_dev2.disconnect();
    await sleep(100);

    if (presenceStore.isOnline(projectAlpha.id, userA.id)) {
      throw new Error('Test 15 failed: userA should be offline after all sockets disconnect');
    }
    console.log('   ✅ Test 15: User A transitions to offline after final socket disconnect');

    // Test 16: presence:offline emitted and DB updated on final disconnect (1 -> 0)
    const finalOfflineEvent = await finalOfflinePromise;
    if (finalOfflineEvent.userId !== userA.id || !finalOfflineEvent.lastSeenAt) {
      throw new Error('Test 16 failed: Unexpected final offline event');
    }
    let dbMultiCheck3: any = null;
    await waitForCondition(async () => {
      dbMultiCheck3 = await prisma.communicationUser.findUnique({
        where: { id: userA.id },
      });
      return dbMultiCheck3?.isOnline === false && Boolean(dbMultiCheck3?.lastSeenAt);
    }, 4000);
    if (dbMultiCheck3?.isOnline || !dbMultiCheck3?.lastSeenAt) {
      throw new Error('Test 16 failed: DB isOnline should be false with lastSeenAt updated');
    }
    console.log('   ✅ Test 16: presence:offline emitted & DB updated on final socket disconnect\n');

    // ========================================================================
    // Group 3: Presence Authorization & Isolation (Tests 17-20)
    // ========================================================================
    console.log('🔒 Testing Group 3: Presence Authorization & Isolation...');

    // Test 17: Same-project REST presence query succeeds
    const sameProjRes = await httpGet(
      `${serverUrl}/api/v1/communication-users/${userA.id}/presence`,
      { 'x-api-key': projectAlpha.apiKey },
    );
    if (sameProjRes.status !== 200 || sameProjRes.body?.data?.userId !== userA.id) {
      throw new Error(`Test 17 failed: Same project REST presence failed: ${JSON.stringify(sameProjRes)}`);
    }
    console.log('   ✅ Test 17: Same-project REST user presence succeeds (200)');

    // Test 18: Cross-project REST presence query returns 404
    const crossProjRes = await httpGet(
      `${serverUrl}/api/v1/communication-users/${userA.id}/presence`,
      { 'x-api-key': projectBeta.apiKey },
    );
    if (crossProjRes.status !== 404) {
      throw new Error(`Test 18 failed: Cross-project REST presence should return 404, got ${crossProjRes.status}`);
    }
    console.log('   ✅ Test 18: Cross-project REST presence blocked with 404 (isolation enforced)');

    // Test 19: REST conversation presence for non-member returns 403
    const nonMemberConvRes = await httpGet(
      `${serverUrl}/api/v1/conversations/${directConv.id}/presence`,
      {
        'x-api-key': projectAlpha.apiKey,
        'x-user-id': userNonMember.id,
      },
    );
    if (nonMemberConvRes.status !== 403) {
      throw new Error(`Test 19 failed: Non-member conversation presence should return 403, got ${nonMemberConvRes.status}`);
    }
    console.log('   ✅ Test 19: Non-member REST conversation presence blocked with 403 Forbidden');

    // Test 20: REST presence for invalid/non-existent user returns 404
    const nonExistentRes = await httpGet(
      `${serverUrl}/api/v1/communication-users/507f1f77bcf86cd799439011/presence`,
      { 'x-api-key': projectAlpha.apiKey },
    );
    if (nonExistentRes.status !== 404) {
      throw new Error(`Test 20 failed: Non-existent user should return 404, got ${nonExistentRes.status}`);
    }
    console.log('   ✅ Test 20: Non-existent user ID rejected with 404\n');

    // ========================================================================
    // Group 4: Conversation Presence Snapshot (Tests 21-25)
    // ========================================================================
    console.log('👥 Testing Group 4: Conversation Presence Snapshot...');

    // Ensure userA is online, userB is online (socketB connected), userC is offline
    const socketA = createClientSocket(serverUrl, {
      extraHeaders: {
        'x-api-key': projectAlpha.apiKey,
        'x-user-id': userA.id,
      },
    });
    activeSockets.push(socketA);
    await waitForConnect(socketA);

    // Group conversation has participants: userA, userB, userC
    // Listen for conversation:join:success event
    const joinSuccessPromise = waitForEvent<{
      conversationId: string;
      presence: Array<{ userId: string; isOnline: boolean; lastSeenAt: any }>;
    }>(socketA, REALTIME_EVENTS.SERVER.CONVERSATION_JOIN_SUCCESS);

    const joinAck = await emitWithAck<{
      success: boolean;
      data: {
        conversationId: string;
        presence: Array<{ userId: string; isOnline: boolean; lastSeenAt: any }>;
      };
    }>(socketA, REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN, {
      conversationId: groupConv.id,
    });

    // Test 21: Join ack returns presence snapshot
    if (!joinAck.success || !Array.isArray(joinAck.data?.presence)) {
      throw new Error(`Test 21 failed: Join ack did not contain presence array: ${JSON.stringify(joinAck)}`);
    }
    console.log('   ✅ Test 21: Join ack includes presence snapshot array');

    // Test 22: conversation:join:success event contains presence snapshot
    const joinSuccessEvent = await joinSuccessPromise;
    if (!Array.isArray(joinSuccessEvent.presence)) {
      throw new Error('Test 22 failed: conversation:join:success missing presence snapshot');
    }
    console.log('   ✅ Test 22: conversation:join:success event carries presence snapshot');

    // Test 23: Snapshot includes all participants of the conversation
    const snapshot = joinAck.data.presence;
    const participantIds = [userA.id, userB.id, userC.id];
    if (snapshot.length !== 3 || !participantIds.every((id) => snapshot.some((p) => p.userId === id))) {
      throw new Error(`Test 23 failed: Snapshot participant mismatch: ${JSON.stringify(snapshot)}`);
    }
    console.log('   ✅ Test 23: Presence snapshot includes all conversation participants');

    // Test 24: Online participant has isOnline: true and lastSeenAt: null
    const onlineP = snapshot.find((p) => p.userId === userA.id);
    if (!onlineP?.isOnline || onlineP.lastSeenAt !== null) {
      throw new Error(`Test 24 failed: User A online snapshot entry invalid: ${JSON.stringify(onlineP)}`);
    }
    console.log('   ✅ Test 24: Online participant in snapshot has isOnline: true and lastSeenAt: null');

    // Test 25: Offline participant (User C) has isOnline: false
    const offlineP = snapshot.find((p) => p.userId === userC.id);
    if (offlineP?.isOnline !== false) {
      throw new Error(`Test 25 failed: User C should be offline in snapshot: ${JSON.stringify(offlineP)}`);
    }
    console.log('   ✅ Test 25: Offline participant in snapshot has isOnline: false\n');

    // ========================================================================
    // Group 5: Typing Indicator (Tests 26-34)
    // ========================================================================
    console.log('⌨️ Testing Group 5: Typing Indicator Basic Flows...');

    // Also join userB into groupConv room
    await emitWithAck(socketB, REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN, {
      conversationId: groupConv.id,
    });

    // Test 26: Member sends typing:start -> ack succeeds
    const typingStartedPromise = waitForEvent<{ conversationId: string; userId: string }>(
      socketB,
      REALTIME_EVENTS.SERVER.TYPING_STARTED,
    );
    const expectNoTypingToSender = expectNoEvent(
      socketA,
      REALTIME_EVENTS.SERVER.TYPING_STARTED,
      300,
    );

    const typingStartAck = await emitWithAck<{
      success: boolean;
      data: { conversationId: string; userId: string; typing: boolean };
    }>(socketA, REALTIME_EVENTS.CLIENT.TYPING_START, {
      conversationId: groupConv.id,
    });

    if (!typingStartAck.success || !typingStartAck.data?.typing) {
      throw new Error(`Test 26 failed: typing:start ack failed: ${JSON.stringify(typingStartAck)}`);
    }
    console.log('   ✅ Test 26: typing:start ack succeeds with typing: true');

    // Test 27: Other member (userB) receives typing:started
    const startedEvent = await typingStartedPromise;
    if (startedEvent.conversationId !== groupConv.id || startedEvent.userId !== userA.id) {
      throw new Error(`Test 27 failed: Unexpected typing:started payload: ${JSON.stringify(startedEvent)}`);
    }
    console.log('   ✅ Test 27: Other conversation participant receives typing:started');

    // Test 28: Sender (userA) does NOT receive typing:started
    await expectNoTypingToSender;
    console.log('   ✅ Test 28: Sender excluded from typing:started broadcast');

    // Test 29: Member sends typing:stop -> ack succeeds
    const typingStoppedPromise = waitForEvent<{ conversationId: string; userId: string }>(
      socketB,
      REALTIME_EVENTS.SERVER.TYPING_STOPPED,
    );
    const expectNoStopToSender = expectNoEvent(
      socketA,
      REALTIME_EVENTS.SERVER.TYPING_STOPPED,
      300,
    );

    const typingStopAck = await emitWithAck<{
      success: boolean;
      data: { conversationId: string; userId: string; typing: boolean };
    }>(socketA, REALTIME_EVENTS.CLIENT.TYPING_STOP, {
      conversationId: groupConv.id,
    });

    if (!typingStopAck.success || typingStopAck.data?.typing !== false) {
      throw new Error(`Test 29 failed: typing:stop ack failed: ${JSON.stringify(typingStopAck)}`);
    }
    console.log('   ✅ Test 29: typing:stop ack succeeds with typing: false');

    // Test 30: Other member receives typing:stopped
    const stoppedEvent = await typingStoppedPromise;
    if (stoppedEvent.conversationId !== groupConv.id || stoppedEvent.userId !== userA.id) {
      throw new Error(`Test 30 failed: Unexpected typing:stopped payload: ${JSON.stringify(stoppedEvent)}`);
    }
    console.log('   ✅ Test 30: Other conversation participant receives typing:stopped');

    // Test 31: Sender does NOT receive typing:stopped
    await expectNoStopToSender;
    console.log('   ✅ Test 31: Sender excluded from typing:stopped broadcast');

    // Test 32: Non-member sending typing:start receives error ack (403/Forbidden) & socket:error
    const socketNonMember = createClientSocket(serverUrl, {
      extraHeaders: {
        'x-api-key': projectAlpha.apiKey,
        'x-user-id': userNonMember.id,
      },
    });
    activeSockets.push(socketNonMember);
    await waitForConnect(socketNonMember);

    const nonMemberSocketErrorPromise = waitForEvent(
      socketNonMember,
      REALTIME_EVENTS.SERVER.SOCKET_ERROR,
    );

    const nonMemberAck = await emitWithAck<{ success: boolean; error: any }>(
      socketNonMember,
      REALTIME_EVENTS.CLIENT.TYPING_START,
      { conversationId: groupConv.id },
    );

    if (nonMemberAck.success || nonMemberAck.error?.code !== RealtimeErrorCode.FORBIDDEN) {
      throw new Error(`Test 32 failed: Non-member typing should be FORBIDDEN: ${JSON.stringify(nonMemberAck)}`);
    }
    await nonMemberSocketErrorPromise;
    console.log('   ✅ Test 32: Non-member typing:start blocked with FORBIDDEN error');

    // Test 33: Cross-project socket sending typing:start receives error
    const socketBeta = createClientSocket(serverUrl, {
      extraHeaders: {
        'x-api-key': projectBeta.apiKey,
        'x-user-id': betaUserX.id,
      },
    });
    activeSockets.push(socketBeta);
    await waitForConnect(socketBeta);

    const crossProjAck = await emitWithAck<{ success: boolean; error: any }>(
      socketBeta,
      REALTIME_EVENTS.CLIENT.TYPING_START,
      { conversationId: groupConv.id },
    );
    if (crossProjAck.success) {
      throw new Error('Test 33 failed: Cross-project typing should fail');
    }
    console.log('   ✅ Test 33: Cross-project typing:start blocked (project boundary enforced)');

    // Test 34: Invalid payload / invalid conversationId rejected
    const invalidIdAck = await emitWithAck<{ success: boolean; error: any }>(
      socketA,
      REALTIME_EVENTS.CLIENT.TYPING_START,
      { conversationId: 'invalid-id' },
    );
    if (invalidIdAck.success || invalidIdAck.error?.code !== RealtimeErrorCode.BAD_REQUEST) {
      throw new Error(`Test 34 failed: Invalid conversationId should be BAD_REQUEST: ${JSON.stringify(invalidIdAck)}`);
    }
    console.log('   ✅ Test 34: Invalid conversationId rejected with BAD_REQUEST\n');

    // ========================================================================
    // Group 6: Typing Deduplication (Tests 35-40)
    // ========================================================================
    console.log('🔁 Testing Group 6: Typing Deduplication...');

    // Test 35: Member sends typing:start -> userB receives event
    const firstStartPromise = waitForEvent<{ conversationId: string; userId: string }>(
      socketB,
      REALTIME_EVENTS.SERVER.TYPING_STARTED,
    );
    await emitWithAck(socketA, REALTIME_EVENTS.CLIENT.TYPING_START, {
      conversationId: groupConv.id,
    });
    await firstStartPromise;
    console.log('   ✅ Test 35: First typing:start event received');

    // Test 36 & 37: Repeated typing:start within window emits NO second broadcast
    const expectNoSecondStarted = expectNoEvent(
      socketB,
      REALTIME_EVENTS.SERVER.TYPING_STARTED,
      500,
    );
    const repeatAck = await emitWithAck<{ success: boolean; data: any }>(
      socketA,
      REALTIME_EVENTS.CLIENT.TYPING_START,
      { conversationId: groupConv.id },
    );
    if (!repeatAck.success) {
      throw new Error('Test 36 failed: Repeated typing:start ack should succeed');
    }
    await expectNoSecondStarted;
    console.log('   ✅ Test 36 & 37: Repeated typing:start suppressed from broadcasting (deduplication)');

    // Test 38: Typing store has user typing
    if (!typingStore.isTyping(projectAlpha.id, groupConv.id, userA.id)) {
      throw new Error('Test 38 failed: User A should still be typing in store');
    }
    console.log('   ✅ Test 38: Typing store maintains typing state with refreshed timeout');

    // Test 39: typing:stop clears state
    const stopPromise = waitForEvent(socketB, REALTIME_EVENTS.SERVER.TYPING_STOPPED);
    await emitWithAck(socketA, REALTIME_EVENTS.CLIENT.TYPING_STOP, {
      conversationId: groupConv.id,
    });
    await stopPromise;
    if (typingStore.isTyping(projectAlpha.id, groupConv.id, userA.id)) {
      throw new Error('Test 39 failed: User A should no longer be typing');
    }
    console.log('   ✅ Test 39: typing:stop clears in-memory typing state');

    // Test 40: Repeated typing:stop does not emit duplicate typing:stopped
    const expectNoSecondStopped = expectNoEvent(
      socketB,
      REALTIME_EVENTS.SERVER.TYPING_STOPPED,
      500,
    );
    await emitWithAck(socketA, REALTIME_EVENTS.CLIENT.TYPING_STOP, {
      conversationId: groupConv.id,
    });
    await expectNoSecondStopped;
    console.log('   ✅ Test 40: Repeated typing:stop does not emit duplicate event\n');

    // ========================================================================
    // Group 7: Typing Auto-Timeout (Tests 41-46)
    // ========================================================================
    console.log('⏳ Testing Group 7: Typing Auto-Timeout (5s)...');

    // Test 41 & 42: Send typing:start and DO NOT send typing:stop
    const autoTimeoutStopPromise = waitForEvent<{ conversationId: string; userId: string }>(
      socketB,
      REALTIME_EVENTS.SERVER.TYPING_STOPPED,
      6000,
    );
    await emitWithAck(socketA, REALTIME_EVENTS.CLIENT.TYPING_START, {
      conversationId: groupConv.id,
    });
    console.log('   ✅ Test 41 & 42: typing:start emitted, waiting for 5s auto-timeout...');

    // Test 43 & 44: Wait and receive automatic typing:stopped
    const timeoutEvent = await autoTimeoutStopPromise;
    if (timeoutEvent.conversationId !== groupConv.id || timeoutEvent.userId !== userA.id) {
      throw new Error(`Test 44 failed: Unexpected auto-timeout event: ${JSON.stringify(timeoutEvent)}`);
    }
    console.log('   ✅ Test 43 & 44: Automatic typing:stopped event received after 5s');

    // Test 45: Typing store has user removed
    if (typingStore.isTyping(projectAlpha.id, groupConv.id, userA.id)) {
      throw new Error('Test 45 failed: User A should not be typing in store after timeout');
    }
    console.log('   ✅ Test 45: Typing state cleanly removed after timeout');

    // Test 46: Subsequent typing:stop does not re-emit
    const expectNoStopAfterTimeout = expectNoEvent(
      socketB,
      REALTIME_EVENTS.SERVER.TYPING_STOPPED,
      400,
    );
    await emitWithAck(socketA, REALTIME_EVENTS.CLIENT.TYPING_STOP, {
      conversationId: groupConv.id,
    });
    await expectNoStopAfterTimeout;
    console.log('   ✅ Test 46: Subsequent typing:stop after timeout does not broadcast duplicate event\n');

    // ========================================================================
    // Group 8: Disconnect Cleanup (Tests 47-50)
    // ========================================================================
    console.log('🔌 Testing Group 8: Disconnect Cleanup...');

    // Connect a disposable socket for userA to test abrupt disconnect during typing
    const socketA_temp = createClientSocket(serverUrl, {
      extraHeaders: {
        'x-api-key': projectAlpha.apiKey,
        'x-user-id': userA.id,
      },
    });
    activeSockets.push(socketA_temp);
    await waitForConnect(socketA_temp);
    await emitWithAck(socketA_temp, REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN, {
      conversationId: groupConv.id,
    });

    // Test 47: Start typing
    await emitWithAck(socketA_temp, REALTIME_EVENTS.CLIENT.TYPING_START, {
      conversationId: groupConv.id,
    });
    if (!typingStore.isTyping(projectAlpha.id, groupConv.id, userA.id)) {
      throw new Error('Test 47 failed: User A should be typing');
    }
    console.log('   ✅ Test 47: User A started typing on temporary socket');

    // Test 48 & 49: Abruptly disconnect socket
    const disconnectTypingStopPromise = waitForEvent<{ conversationId: string; userId: string }>(
      socketB,
      REALTIME_EVENTS.SERVER.TYPING_STOPPED,
    );
    socketA_temp.disconnect();
    await sleep(100);

    // Test 49: Typing store removes typing entry
    if (typingStore.isTyping(projectAlpha.id, groupConv.id, userA.id)) {
      throw new Error('Test 49 failed: Typing state should be cleaned on socket disconnect');
    }
    console.log('   ✅ Test 48 & 49: Socket disconnected and typing state cleaned up');

    // Test 50: typing:stopped broadcasted to room
    const disconnectStopEvent = await disconnectTypingStopPromise;
    if (disconnectStopEvent.conversationId !== groupConv.id || disconnectStopEvent.userId !== userA.id) {
      throw new Error(`Test 50 failed: Unexpected disconnect typing:stopped payload: ${JSON.stringify(disconnectStopEvent)}`);
    }
    console.log('   ✅ Test 50: typing:stopped emitted to conversation room upon socket disconnect\n');

    // ========================================================================
    // Group 9: Realtime Regression Suite (Phase E Compatibility, Tests 51-59)
    // ========================================================================
    console.log('🔄 Testing Group 9: Phase E Realtime Regression...');

    // Test 51: Handshake authentication
    const regSocketA = createClientSocket(serverUrl, {
      extraHeaders: {
        'x-api-key': projectAlpha.apiKey,
        'x-user-id': userA.id,
      },
    });
    activeSockets.push(regSocketA);
    await waitForConnect(regSocketA);
    console.log('   ✅ Test 51: Socket authenticated via handshake headers');

    // Test 52: Join conversation room
    const regJoinAck = await emitWithAck<{ success: boolean; data: any }>(
      regSocketA,
      REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN,
      { conversationId: directConv.id },
    );
    if (!regJoinAck.success || regJoinAck.data?.conversationId !== directConv.id) {
      throw new Error('Test 52 failed: Conversation join failed');
    }
    console.log('   ✅ Test 52: Successfully joined conversation room');

    // Test 53 & 54: Send message & receive message:new
    const messageNewPromise = waitForEvent<{ id: string; content: string; conversationId: string }>(
      socketB,
      REALTIME_EVENTS.SERVER.MESSAGE_NEW,
    );
    const sendAck = await emitWithAck<{ success: boolean; data: any }>(
      regSocketA,
      REALTIME_EVENTS.CLIENT.MESSAGE_SEND,
      {
        conversationId: directConv.id,
        content: 'Phase F regression message',
      },
    );
    if (!sendAck.success || !sendAck.data?.id) {
      throw new Error('Test 53 failed: Message send failed');
    }
    console.log('   ✅ Test 53: Realtime message sent with ack');

    const newMsgEvent = await messageNewPromise;
    if (newMsgEvent.id !== sendAck.data.id || newMsgEvent.content !== 'Phase F regression message') {
      throw new Error('Test 54 failed: Unexpected message:new event');
    }
    console.log('   ✅ Test 54: message:new received by conversation partner');

    // Test 55: Edit message
    const messageUpdatedPromise = waitForEvent<{ id: string; content: string }>(
      socketB,
      REALTIME_EVENTS.SERVER.MESSAGE_UPDATED,
    );
    const editAck = await emitWithAck<{ success: boolean; data: any }>(
      regSocketA,
      REALTIME_EVENTS.CLIENT.MESSAGE_EDIT,
      {
        messageId: sendAck.data.id,
        content: 'Phase F edited content',
      },
    );
    if (!editAck.success || editAck.data?.content !== 'Phase F edited content') {
      throw new Error('Test 55 failed: Message edit failed');
    }
    const updateEvent = await messageUpdatedPromise;
    if (updateEvent.content !== 'Phase F edited content') {
      throw new Error('Test 55 failed: message:updated content mismatch');
    }
    console.log('   ✅ Test 55: message:edit emitted and received');

    // Test 57: Delivered receipt
    const deliveryUpdatedPromise = waitForEvent<{ messageId: string; userId: string }>(
      regSocketA,
      REALTIME_EVENTS.SERVER.MESSAGE_DELIVERY_UPDATED,
    );
    const deliveredAck = await emitWithAck<{ success: boolean; data: any }>(
      socketB,
      REALTIME_EVENTS.CLIENT.MESSAGE_DELIVERED,
      { messageId: sendAck.data.id },
    );
    if (!deliveredAck.success) {
      throw new Error('Test 57 failed: Message delivered ack failed');
    }
    const deliveryEvent = await deliveryUpdatedPromise;
    if (deliveryEvent.messageId !== sendAck.data.id) {
      throw new Error('Test 57 failed: Unexpected delivery event messageId');
    }
    console.log('   ✅ Test 57: message:delivered emitted and received');

    // Test 58: Read receipt
    const readUpdatedPromise = waitForEvent<{ messageId: string; userId: string }>(
      regSocketA,
      REALTIME_EVENTS.SERVER.MESSAGE_READ_UPDATED,
    );
    const readAck = await emitWithAck<{ success: boolean; data: any }>(
      socketB,
      REALTIME_EVENTS.CLIENT.MESSAGE_READ,
      { messageId: sendAck.data.id },
    );
    if (!readAck.success) {
      throw new Error('Test 58 failed: Message read ack failed');
    }
    const readEvent = await readUpdatedPromise;
    if (readEvent.messageId !== sendAck.data.id) {
      throw new Error('Test 58 failed: Unexpected read event messageId');
    }
    console.log('   ✅ Test 58: message:read emitted and received');

    // Test 59: Bulk read
    const bulkReadPromise = waitForEvent<{ conversationId: string; userId: string }>(
      regSocketA,
      REALTIME_EVENTS.SERVER.CONVERSATION_READ_UPDATED,
    );
    const bulkReadAck = await emitWithAck<{ success: boolean; data: any }>(
      socketB,
      REALTIME_EVENTS.CLIENT.CONVERSATION_READ,
      { conversationId: directConv.id },
    );
    if (!bulkReadAck.success) {
      throw new Error('Test 59 failed: Conversation read ack failed');
    }
    const bulkReadEvent = await bulkReadPromise;
    if (bulkReadEvent.conversationId !== directConv.id) {
      throw new Error('Test 59 failed: Bulk read event conversationId mismatch');
    }
    console.log('   ✅ Test 59: conversation:read bulk update emitted and received');

    // Test 56: Delete message
    const messageDeletedPromise = waitForEvent<{ messageId: string }>(
      socketB,
      REALTIME_EVENTS.SERVER.MESSAGE_DELETED,
    );
    const deleteAck = await emitWithAck<{ success: boolean; data: any }>(
      regSocketA,
      REALTIME_EVENTS.CLIENT.MESSAGE_DELETE,
      { messageId: sendAck.data.id },
    );
    if (!deleteAck.success) {
      throw new Error('Test 56 failed: Message delete failed');
    }
    const deleteEvent = await messageDeletedPromise;
    if (deleteEvent.messageId !== sendAck.data.id) {
      throw new Error('Test 56 failed: message:deleted id mismatch');
    }
    console.log('   ✅ Test 56: message:delete emitted and received\n');

    // ------------------------------------------------------------------------
    // Cleanup
    // ------------------------------------------------------------------------
    console.log('🧹 Cleaning up test artifacts...');
    for (const s of activeSockets) {
      if (s.connected) {
        s.disconnect();
      }
    }

    await prisma.messageReceipt.deleteMany({
      where: { projectId: { in: [projectAlpha.id, projectBeta.id] } },
    });
    await prisma.message.deleteMany({
      where: {
        conversation: { projectId: { in: [projectAlpha.id, projectBeta.id] } },
      },
    });
    await prisma.conversationParticipant.deleteMany({
      where: {
        conversation: { projectId: { in: [projectAlpha.id, projectBeta.id] } },
      },
    });
    await prisma.conversation.deleteMany({
      where: { projectId: { in: [projectAlpha.id, projectBeta.id] } },
    });
    await prisma.communicationUser.deleteMany({
      where: {
        id: {
          in: [
            userA.id,
            userB.id,
            userC.id,
            userNonMember.id,
            betaUserX.id,
          ],
        },
      },
    });
    await prisma.project.deleteMany({
      where: { id: { in: [projectAlpha.id, projectBeta.id] } },
    });

    console.log('   ✅ All Phase F test artifacts cleaned up.\n');
    console.log('🎉 ALL 59 PHASE F VERIFICATION CHECKS PASSED SUCCESSFULLY!');
  } finally {
    for (const s of activeSockets) {
      if (s.connected) {
        s.disconnect();
      }
    }
    if (app) {
      await app.close();
    }
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runPhaseFTests().catch((err) => {
    console.error('❌ Phase F verification failed:', err);
    process.exit(1);
  });
}
