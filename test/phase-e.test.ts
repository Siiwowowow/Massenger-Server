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

// ============================================================================
// Helper functions for Socket.IO client testing
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
    timeout: 3000,
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

function expectConnectFailure(
  socket: ClientSocket,
  timeoutMs = 4000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Expected connection failure, but socket stayed connected for ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      resolve(err);
    });

    socket.once(REALTIME_EVENTS.SERVER.SOCKET_ERROR, (err) => {
      clearTimeout(timer);
      resolve(err);
    });

    socket.once('disconnect', (reason) => {
      clearTimeout(timer);
      resolve({ reason });
    });

    socket.once('connect', () => {
      setTimeout(() => {
        if (!socket.connected) {
          clearTimeout(timer);
          resolve({ disconnected: true });
        }
      }, 500);
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

// ============================================================================
// Main Phase E Test Suite
// ============================================================================

export async function runPhaseETests() {
  console.log(
    '🧪 Starting Phase E Automated Verification: Realtime Chat with Socket.IO...\n',
  );

  const prisma = new PrismaClient() as unknown as PrismaService;
  const projectService = new ProjectService(prisma);
  const commUserService = new CommunicationUserService(prisma);
  const conversationService = new ConversationService(prisma);

  let app: INestApplication | null = null;
  // eslint-disable-next-line no-useless-assignment
  let serverUrl = '';
  const activeSockets: ClientSocket[] = [];

  const timestamp = Date.now();
  const slugAlpha = `test-e-alpha-${timestamp}`;
  const slugBeta = `test-e-beta-${timestamp}`;

  try {
    // ------------------------------------------------------------------------
    // Step 0: Bootstrap Test NestJS Application
    // ------------------------------------------------------------------------
    console.log('0️⃣ Bootstrapping NestJS application for Socket.IO E2E harness...');
    app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
    await app.listen(0);
    const httpServer = app.getHttpServer();
    const address = httpServer.address();
    const port = typeof address === 'string' ? address : address.port;
    serverUrl = `http://localhost:${port}`;
    console.log(`   ✅ NestJS Server running at ${serverUrl}\n`);

    // ------------------------------------------------------------------------
    // Step 1: Create Projects, Users, Conversations
    // ------------------------------------------------------------------------
    console.log('1️⃣ Setup: Creating test projects, users, and conversations...');
    const projectAlpha = await projectService.create({
      name: 'Project Alpha (Phase E)',
      slug: slugAlpha,
    });
    const projectBeta = await projectService.create({
      name: 'Project Beta (Phase E)',
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
      externalId: `alpha_user_nm_${timestamp}`,
      name: 'David NonMember',
      email: 'david@alpha.test',
    });

    const betaUserX = await commUserService.sync(projectBeta.id, {
      externalId: `beta_user_x_${timestamp}`,
      name: 'Xavier Beta',
      email: 'xavier@beta.test',
    });

    // Direct conversation in Alpha: Alice & Bob
    const directAlpha = await conversationService.createDirect(
      projectAlpha.id,
      userA.id,
      userB.id,
    );

    // Group conversation in Alpha: Alice (Admin), Bob (Member), Charlie (Member)
    const groupAlpha = await conversationService.createGroup(
      projectAlpha.id,
      userA.id,
      {
        title: 'Alpha Engineering Realtime',
        participantIds: [userB.id, userC.id],
      },
    );

    // Direct conversation in Beta: Xavier & Yolanda (create Yolanda)
    const betaUserY = await commUserService.sync(projectBeta.id, {
      externalId: `beta_user_y_${timestamp}`,
      name: 'Yolanda Beta',
      email: 'yolanda@beta.test',
    });
    const directBeta = await conversationService.createDirect(
      projectBeta.id,
      betaUserX.id,
      betaUserY.id,
    );

    console.log('   ✅ Test data setup complete.\n');

    // ========================================================================
    // Category 1: CONNECTION (Tests 1-4)
    // ========================================================================
    console.log('📡 Category 1: Testing Socket Connection & Authentication...');

    // 1. Valid socket authentication succeeds
    const socketAlice = createClientSocket(serverUrl, {
      auth: { projectId: projectAlpha.id, userId: userA.id },
    });
    activeSockets.push(socketAlice);
    await waitForConnect(socketAlice);
    console.log('   ✅ 1. Valid socket authentication succeeds.');

    // 2. Invalid authentication is rejected
    const socketBadUser = createClientSocket(serverUrl, {
      auth: {
        projectId: projectAlpha.id,
        userId: '65f000000000000000000000',
      },
    });
    activeSockets.push(socketBadUser);
    await expectConnectFailure(socketBadUser);
    console.log('   ✅ 2. Invalid authentication is rejected.');

    // 3. Missing project context is rejected
    const socketNoProject = createClientSocket(serverUrl, {
      auth: { userId: userA.id },
    });
    activeSockets.push(socketNoProject);
    await expectConnectFailure(socketNoProject);
    console.log('   ✅ 3. Missing project context is rejected.');

    // 4. Invalid user format is rejected
    const socketInvalidUser = createClientSocket(serverUrl, {
      auth: { projectId: projectAlpha.id, userId: 'invalid_format' },
    });
    activeSockets.push(socketInvalidUser);
    await expectConnectFailure(socketInvalidUser);
    console.log('   ✅ 4. Invalid user format is rejected.\n');

    // Connect additional authenticated sockets for subsequent tests
    const socketBob = createClientSocket(serverUrl, {
      auth: { projectId: projectAlpha.id, userId: userB.id },
    });
    activeSockets.push(socketBob);
    await waitForConnect(socketBob);

    const socketCharlie = createClientSocket(serverUrl, {
      auth: { projectId: projectAlpha.id, userId: userC.id },
    });
    activeSockets.push(socketCharlie);
    await waitForConnect(socketCharlie);

    const socketNonMember = createClientSocket(serverUrl, {
      auth: { projectId: projectAlpha.id, userId: userNonMember.id },
    });
    activeSockets.push(socketNonMember);
    await waitForConnect(socketNonMember);

    const socketBetaX = createClientSocket(serverUrl, {
      auth: { projectId: projectBeta.id, userId: betaUserX.id },
    });
    activeSockets.push(socketBetaX);
    await waitForConnect(socketBetaX);

    // ========================================================================
    // Category 2: CONVERSATION (Tests 5-9)
    // ========================================================================
    console.log('🚪 Category 2: Testing Conversation Room Management...');

    // 5. Member can join conversation
    const joinResAlice = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN,
      { conversationId: directAlpha.id },
    );
    if (!joinResAlice.success || joinResAlice.data?.conversationId !== directAlpha.id) {
      throw new Error('❌ Member failed to join conversation!');
    }
    console.log('   ✅ 5. Member can join conversation.');

    // Bob also joins direct conversation
    const joinResBob = await emitWithAck(
      socketBob,
      REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN,
      { conversationId: directAlpha.id },
    );
    if (!joinResBob.success) {
      throw new Error('❌ Bob failed to join conversation!');
    }

    // 6. Non-member cannot join
    const joinResNonMember = await emitWithAck(
      socketNonMember,
      REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN,
      { conversationId: directAlpha.id },
    );
    if (
      joinResNonMember.success ||
      joinResNonMember.error?.code !== RealtimeErrorCode.FORBIDDEN
    ) {
      throw new Error('❌ Non-member was improperly allowed to join conversation!');
    }
    console.log('   ✅ 6. Non-member cannot join conversation (403 FORBIDDEN).');

    // 7. Cross-project user cannot join
    const joinResCross = await emitWithAck(
      socketBetaX,
      REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN,
      { conversationId: directAlpha.id },
    );
    if (joinResCross.success) {
      throw new Error('❌ Cross-project user joined Alpha conversation!');
    }
    console.log('   ✅ 7. Cross-project user cannot join Alpha conversation.');

    // 8. Member can leave room
    const leaveRes = await emitWithAck(
      socketBob,
      REALTIME_EVENTS.CLIENT.CONVERSATION_LEAVE,
      { conversationId: directAlpha.id },
    );
    if (!leaveRes.success) {
      throw new Error('❌ Member failed to leave conversation room!');
    }
    console.log('   ✅ 8. Member can leave room.');

    // 9. Cross-project room access is blocked
    const joinBetaGroup = await emitWithAck(
      socketBetaX,
      REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN,
      { conversationId: groupAlpha.id },
    );
    if (joinBetaGroup.success) {
      throw new Error('❌ Cross-project room access was not blocked!');
    }
    console.log('   ✅ 9. Cross-project room access is blocked.\n');

    // Rejoin Bob to directAlpha for message testing
    await emitWithAck(
      socketBob,
      REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN,
      { conversationId: directAlpha.id },
    );

    // ========================================================================
    // Category 3: MESSAGE (Tests 10-14)
    // ========================================================================
    console.log('💬 Category 3: Testing Realtime Message Send & Broadcast...');

    // 10, 13, 14. Member can send message, persisted message returned, message:new emitted
    const messageNewPromise = waitForEvent(
      socketBob,
      REALTIME_EVENTS.SERVER.MESSAGE_NEW,
    );

    const sendRes = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.MESSAGE_SEND,
      {
        conversationId: directAlpha.id,
        content: 'Hello Bob via Socket.IO!',
      },
    );

    // 10. Member can send
    if (!sendRes.success) {
      throw new Error(`❌ Member sending message failed: ${sendRes.error?.message}`);
    }
    console.log('   ✅ 10. Member can send realtime message.');

    // 13. Persisted message is returned
    const sentMsg = sendRes.message || sendRes.data;
    if (
      !sentMsg?.id ||
      sentMsg.conversationId !== directAlpha.id ||
      sentMsg.content !== 'Hello Bob via Socket.IO!' ||
      sentMsg.senderId !== userA.id
    ) {
      throw new Error('❌ Persisted message payload is incomplete or invalid!');
    }
    console.log('   ✅ 13. Persisted message is returned in ack.');

    // 14. message:new is emitted to room
    const receivedMsg = await messageNewPromise;
    if (receivedMsg.id !== sentMsg.id || receivedMsg.content !== sentMsg.content) {
      throw new Error('❌ message:new event payload mismatch!');
    }
    console.log('   ✅ 14. message:new is emitted to conversation room.');

    // 11. Non-member cannot send
    const sendResNonMember = await emitWithAck(
      socketNonMember,
      REALTIME_EVENTS.CLIENT.MESSAGE_SEND,
      {
        conversationId: directAlpha.id,
        content: 'Intruder message',
      },
    );
    if (
      sendResNonMember.success ||
      sendResNonMember.error?.code !== RealtimeErrorCode.FORBIDDEN
    ) {
      throw new Error('❌ Non-member was allowed to send message!');
    }
    console.log('   ✅ 11. Non-member cannot send realtime message.');

    // 12. Cross-project user cannot send
    const sendResCross = await emitWithAck(
      socketBetaX,
      REALTIME_EVENTS.CLIENT.MESSAGE_SEND,
      {
        conversationId: directAlpha.id,
        content: 'Cross project message',
      },
    );
    if (sendResCross.success) {
      throw new Error('❌ Cross-project user was allowed to send message!');
    }
    console.log('   ✅ 12. Cross-project user cannot send.\n');

    // ========================================================================
    // Category 4: EDIT (Tests 15-17)
    // ========================================================================
    console.log('✏️ Category 4: Testing Realtime Message Edit...');

    // 15, 17. Sender can edit & updated event emitted
    const messageUpdatedPromise = waitForEvent(
      socketBob,
      REALTIME_EVENTS.SERVER.MESSAGE_UPDATED,
    );

    const editRes = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.MESSAGE_EDIT,
      {
        messageId: sentMsg.id,
        content: 'Hello Bob (Edited content)!',
      },
    );

    if (!editRes.success || (editRes.message || editRes.data)?.content !== 'Hello Bob (Edited content)!') {
      throw new Error('❌ Sender failed to edit message!');
    }
    console.log('   ✅ 15. Sender can edit message.');

    const updatedEvent = await messageUpdatedPromise;
    if (updatedEvent.id !== sentMsg.id || updatedEvent.content !== 'Hello Bob (Edited content)!') {
      throw new Error('❌ message:updated event payload invalid!');
    }
    console.log('   ✅ 17. Updated event emitted to conversation room.');

    // 16. Non-sender cannot edit
    const editResBob = await emitWithAck(
      socketBob,
      REALTIME_EVENTS.CLIENT.MESSAGE_EDIT,
      {
        messageId: sentMsg.id,
        content: 'Hacked by Bob!',
      },
    );
    if (
      editResBob.success ||
      editResBob.error?.code !== RealtimeErrorCode.FORBIDDEN
    ) {
      throw new Error('❌ Non-sender was allowed to edit message!');
    }
    console.log('   ✅ 16. Non-sender cannot edit message (403 FORBIDDEN).\n');

    // ========================================================================
    // Category 5: DELETE (Tests 18-21)
    // ========================================================================
    console.log('🗑️ Category 5: Testing Realtime Message Soft-Delete...');

    // 19. Non-sender cannot delete
    const deleteResBob = await emitWithAck(
      socketBob,
      REALTIME_EVENTS.CLIENT.MESSAGE_DELETE,
      { messageId: sentMsg.id },
    );
    if (
      deleteResBob.success ||
      deleteResBob.error?.code !== RealtimeErrorCode.FORBIDDEN
    ) {
      throw new Error('❌ Non-sender was allowed to delete message!');
    }
    console.log('   ✅ 19. Non-sender cannot delete message.');

    // 18, 20, 21. Sender can delete, deleted event emitted, content not broadcast
    const messageDeletedPromise = waitForEvent(
      socketBob,
      REALTIME_EVENTS.SERVER.MESSAGE_DELETED,
    );

    const deleteResAlice = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.MESSAGE_DELETE,
      { messageId: sentMsg.id },
    );

    if (!deleteResAlice.success) {
      throw new Error('❌ Sender failed to delete message!');
    }
    console.log('   ✅ 18. Sender can delete message.');

    const deletedEvent = await messageDeletedPromise;
    if (deletedEvent.messageId !== sentMsg.id || !deletedEvent.deletedAt) {
      throw new Error('❌ message:deleted event invalid!');
    }
    console.log('   ✅ 20. Deleted event emitted to conversation room.');

    // 21. Deleted content is not broadcast
    if ('content' in deletedEvent && deletedEvent.content !== undefined && deletedEvent.content !== null) {
      throw new Error('❌ Deleted content was leaked in broadcast payload!');
    }
    console.log('   ✅ 21. Deleted content is not broadcast in realtime payload.\n');

    // ========================================================================
    // Category 6: RECEIPTS (Tests 22-26)
    // ========================================================================
    console.log('📬 Category 6: Testing Realtime Delivery & Read Receipts...');

    // Alice sends a new message for receipt testing
    const sendRes2 = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.MESSAGE_SEND,
      {
        conversationId: directAlpha.id,
        content: 'Receipt test message #1',
      },
    );
    const receiptMsg = sendRes2.message || sendRes2.data;

    // 22. Recipient can mark delivered
    const deliveryUpdatedPromise = waitForEvent(
      socketAlice,
      REALTIME_EVENTS.SERVER.MESSAGE_DELIVERY_UPDATED,
    );

    const deliveredRes = await emitWithAck(
      socketBob,
      REALTIME_EVENTS.CLIENT.MESSAGE_DELIVERED,
      { messageId: receiptMsg.id },
    );

    if (!deliveredRes.success || !deliveredRes.data?.deliveredAt) {
      throw new Error('❌ Recipient failed to mark delivered!');
    }
    console.log('   ✅ 22. Recipient can mark delivered.');

    const deliveryEvent = await deliveryUpdatedPromise;
    if (
      deliveryEvent.messageId !== receiptMsg.id ||
      deliveryEvent.userId !== userB.id ||
      !deliveryEvent.deliveredAt
    ) {
      throw new Error('❌ message:delivery_updated event payload invalid!');
    }

    // 23. Recipient can mark read
    const readUpdatedPromise = waitForEvent(
      socketAlice,
      REALTIME_EVENTS.SERVER.MESSAGE_READ_UPDATED,
    );

    const readRes = await emitWithAck(
      socketBob,
      REALTIME_EVENTS.CLIENT.MESSAGE_READ,
      { messageId: receiptMsg.id },
    );

    if (!readRes.success || !readRes.data?.readAt) {
      throw new Error('❌ Recipient failed to mark read!');
    }
    console.log('   ✅ 23. Recipient can mark read.');

    const readEvent = await readUpdatedPromise;
    if (
      readEvent.messageId !== receiptMsg.id ||
      readEvent.userId !== userB.id ||
      !readEvent.readAt
    ) {
      throw new Error('❌ message:read_updated event payload invalid!');
    }

    // 24. Read implies delivered
    const sendRes3 = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.MESSAGE_SEND,
      {
        conversationId: directAlpha.id,
        content: 'Receipt test message #2',
      },
    );
    const receiptMsg2 = sendRes3.message || sendRes3.data;

    const directReadRes = await emitWithAck(
      socketBob,
      REALTIME_EVENTS.CLIENT.MESSAGE_READ,
      { messageId: receiptMsg2.id },
    );
    if (
      !directReadRes.success ||
      !directReadRes.data?.readAt ||
      !directReadRes.data?.deliveredAt
    ) {
      throw new Error('❌ Read did not automatically imply delivered!');
    }
    console.log('   ✅ 24. Read implies delivered.');

    // 25. Non-member cannot update receipt
    const nonMemberReceiptRes = await emitWithAck(
      socketNonMember,
      REALTIME_EVENTS.CLIENT.MESSAGE_READ,
      { messageId: receiptMsg2.id },
    );
    if (
      nonMemberReceiptRes.success ||
      nonMemberReceiptRes.error?.code !== RealtimeErrorCode.FORBIDDEN
    ) {
      throw new Error('❌ Non-member was allowed to update receipt!');
    }
    console.log('   ✅ 25. Non-member cannot update receipt.');

    // 26. Cross-project receipt access blocked
    const crossReceiptRes = await emitWithAck(
      socketBetaX,
      REALTIME_EVENTS.CLIENT.MESSAGE_READ,
      { messageId: receiptMsg2.id },
    );
    if (crossReceiptRes.success) {
      throw new Error('❌ Cross-project receipt update succeeded!');
    }
    console.log('   ✅ 26. Cross-project receipt access blocked.\n');

    // ========================================================================
    // Category 7: GROUP (Tests 27-28)
    // ========================================================================
    console.log('👥 Category 7: Testing Group Conversations & Room Broadcasts...');

    // Alice, Bob, Charlie join group room
    await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN,
      { conversationId: groupAlpha.id },
    );
    await emitWithAck(
      socketBob,
      REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN,
      { conversationId: groupAlpha.id },
    );
    await emitWithAck(
      socketCharlie,
      REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN,
      { conversationId: groupAlpha.id },
    );

    // 27. Group members receive new messages
    const bobGroupPromise = waitForEvent(
      socketBob,
      REALTIME_EVENTS.SERVER.MESSAGE_NEW,
    );
    const charlieGroupPromise = waitForEvent(
      socketCharlie,
      REALTIME_EVENTS.SERVER.MESSAGE_NEW,
    );
    const nonMemberNoEventPromise = expectNoEvent(
      socketNonMember,
      REALTIME_EVENTS.SERVER.MESSAGE_NEW,
      600,
    );

    const groupSendRes = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.MESSAGE_SEND,
      {
        conversationId: groupAlpha.id,
        content: 'Engineering sync update for group',
      },
    );
    if (!groupSendRes.success) {
      throw new Error('❌ Failed to send group message!');
    }

    const [bobReceived, charlieReceived] = await Promise.all([
      bobGroupPromise,
      charlieGroupPromise,
    ]);
    if (
      bobReceived.id !== groupSendRes.data.id ||
      charlieReceived.id !== groupSendRes.data.id
    ) {
      throw new Error('❌ Group members did not receive identical message!');
    }
    console.log('   ✅ 27. Group members receive new messages.');

    // 28. Non-members do not receive group messages
    await nonMemberNoEventPromise;
    console.log('   ✅ 28. Non-members do not receive group messages.\n');

    // ========================================================================
    // Category 8: ISOLATION (Tests 29-31)
    // ========================================================================
    console.log('🔒 Category 8: Testing Multi-Tenant Project Boundary Isolation...');

    // 29. Project A socket cannot join Project B conversation
    const joinProjectBRes = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN,
      { conversationId: directBeta.id },
    );
    if (joinProjectBRes.success) {
      throw new Error('❌ Project A socket joined Project B conversation!');
    }
    console.log('   ✅ 29. Project A socket cannot join Project B conversation.');

    // 30. Project A socket cannot send into Project B conversation
    const sendProjectBRes = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.MESSAGE_SEND,
      {
        conversationId: directBeta.id,
        content: 'Cross project injection attempt',
      },
    );
    if (sendProjectBRes.success) {
      throw new Error('❌ Project A socket sent into Project B conversation!');
    }
    console.log('   ✅ 30. Project A socket cannot send into Project B conversation.');

    // 31. Project A cannot receive Project B events
    // Join Beta User X to Beta conversation
    await emitWithAck(
      socketBetaX,
      REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN,
      { conversationId: directBeta.id },
    );

    const aliceNoEventPromise = expectNoEvent(
      socketAlice,
      REALTIME_EVENTS.SERVER.MESSAGE_NEW,
      600,
    );

    await emitWithAck(
      socketBetaX,
      REALTIME_EVENTS.CLIENT.MESSAGE_SEND,
      {
        conversationId: directBeta.id,
        content: 'Beta confidential message',
      },
    );

    await aliceNoEventPromise;
    console.log('   ✅ 31. Project A cannot receive Project B events.\n');

    // ========================================================================
    // Category 9: MULTIPLE SOCKETS (Tests 32-34)
    // ========================================================================
    console.log('📱 Category 9: Testing Multiple Sockets Per User (Multi-Device)...');

    // 32. Same user can connect from two sockets
    const socketAliceDevice2 = createClientSocket(serverUrl, {
      auth: { projectId: projectAlpha.id, userId: userA.id },
    });
    activeSockets.push(socketAliceDevice2);
    await waitForConnect(socketAliceDevice2);
    console.log('   ✅ 32. Same user can connect from two sockets.');

    // Both Alice sockets join directAlpha
    await emitWithAck(
      socketAliceDevice2,
      REALTIME_EVENTS.CLIENT.CONVERSATION_JOIN,
      { conversationId: directAlpha.id },
    );

    // 33. Both sockets receive appropriate events
    const aliceSocket1Promise = waitForEvent(
      socketAlice,
      REALTIME_EVENTS.SERVER.MESSAGE_NEW,
    );
    const aliceSocket2Promise = waitForEvent(
      socketAliceDevice2,
      REALTIME_EVENTS.SERVER.MESSAGE_NEW,
    );

    await emitWithAck(
      socketBob,
      REALTIME_EVENTS.CLIENT.MESSAGE_SEND,
      {
        conversationId: directAlpha.id,
        content: 'Message for all Alice devices',
      },
    );

    const [msg1, msg2] = await Promise.all([
      aliceSocket1Promise,
      aliceSocket2Promise,
    ]);
    if (!msg1 || !msg2 || msg1.id !== msg2.id) {
      throw new Error('❌ Multi-device delivery failed to deliver to both sockets!');
    }
    console.log('   ✅ 33. Both sockets receive appropriate user/conversation events.');

    // 34. One socket disconnecting does not invalidate the other
    socketAliceDevice2.disconnect();
    const aliceSocket1NextPromise = waitForEvent(
      socketAlice,
      REALTIME_EVENTS.SERVER.MESSAGE_NEW,
    );

    await emitWithAck(
      socketBob,
      REALTIME_EVENTS.CLIENT.MESSAGE_SEND,
      {
        conversationId: directAlpha.id,
        content: 'Post-disconnect test message',
      },
    );

    const msgAfterDisconnect = await aliceSocket1NextPromise;
    if (!msgAfterDisconnect) {
      throw new Error('❌ Socket 1 failed after Socket 2 disconnected!');
    }
    console.log('   ✅ 34. One socket disconnecting does not invalidate the other.\n');

    // ========================================================================
    // Category 10: DUPLICATE MESSAGE PROTECTION / IDEMPOTENCY
    // ========================================================================
    console.log('🔁 Category 10: Testing Client Retry Idempotency (Duplicate Protection)...');

    const clientMsgId = `retry_token_${Date.now()}`;

    // First attempt: creates message
    const retry1 = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.MESSAGE_SEND,
      {
        conversationId: directAlpha.id,
        content: 'Message with retry token',
        clientMessageId: clientMsgId,
      },
    );
    if (!retry1.success) {
      throw new Error('❌ First message attempt failed!');
    }

    // Second attempt: identical retry
    const retry2 = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.MESSAGE_SEND,
      {
        conversationId: directAlpha.id,
        content: 'Message with retry token',
        clientMessageId: clientMsgId,
      },
    );
    if (!retry2.success) {
      throw new Error('❌ Retry message attempt failed!');
    }

    if (retry1.data.id !== retry2.data.id) {
      throw new Error('❌ Idempotency failed: two distinct messages created for same clientMessageId!');
    }

    // Verify DB count
    const dbMessages = await prisma.message.findMany({
      where: {
        conversationId: directAlpha.id,
        senderId: userA.id,
      },
    });
    const matching = dbMessages.filter((m) => {
      const meta = m.metadata as Record<string, any> | null;
      return meta?.clientMessageId === clientMsgId;
    });
    if (matching.length !== 1) {
      throw new Error(`❌ Expected exactly 1 message with clientMessageId in DB, found ${matching.length}!`);
    }
    console.log('   ✅ Client retry idempotency: Returned identical message without duplicate DB record.\n');

    // ========================================================================
    // Category 11: BULK CONVERSATION READ
    // ========================================================================
    console.log('📖 Category 11: Testing Bulk Conversation Read Event...');

    const bulkReadPromise = waitForEvent(
      socketAlice,
      REALTIME_EVENTS.SERVER.CONVERSATION_READ_UPDATED,
    );

    const bulkReadRes = await emitWithAck(
      socketBob,
      REALTIME_EVENTS.CLIENT.CONVERSATION_READ,
      { conversationId: directAlpha.id },
    );
    if (!bulkReadRes.success) {
      throw new Error('❌ Bulk read failed!');
    }

    const bulkReadEvent = await bulkReadPromise;
    if (
      bulkReadEvent.conversationId !== directAlpha.id ||
      bulkReadEvent.userId !== userB.id
    ) {
      throw new Error('❌ conversation:read_updated event payload invalid!');
    }
    console.log('   ✅ Bulk conversation read event emitted and acknowledged.\n');

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
            betaUserY.id,
          ],
        },
      },
    });
    await prisma.project.deleteMany({
      where: { id: { in: [projectAlpha.id, projectBeta.id] } },
    });

    console.log('   ✅ All Phase E test artifacts cleaned up.\n');
    console.log('🎉 ALL 34+ PHASE E VERIFICATION CHECKS PASSED SUCCESSFULLY!');
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
  runPhaseETests().catch((err) => {
    console.error('❌ Phase E verification failed:', err);
    process.exit(1);
  });
}
