import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { PrismaClient } from '../src/generated/prisma';
import { PrismaService } from '../src/app/database/prisma.service';
import { ProjectService } from '../src/app/modules/project/project.service';
import { CommunicationUserService } from '../src/app/modules/communication-user/communication-user.service';
import { ConversationService } from '../src/app/modules/conversation/conversation.service';
import { CallSignalingService } from '../src/app/modules/call/call-signaling.service';
import { CallState } from '../src/app/modules/call/call.types';
import {
  REALTIME_EVENTS,
} from '../src/app/modules/realtime/realtime.constants';
import {
  CallIncomingPayload,
  CallAcceptedPayload,
  CallRejectedPayload,
  CallCancelledPayload,
  CallEndedPayload,
  CallBusyPayload,
} from '../src/app/modules/realtime/realtime.types';

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

// ============================================================================
// Main Phase 2 Test Suite
// ============================================================================

export async function runCallPhase2Tests() {
  console.log(
    '🧪 Starting Call Phase 2 Automated Verification: Socket.IO Call Signaling...\n',
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
  const slugAlpha = `test-call2-alpha-${timestamp}`;
  const slugBeta = `test-call2-beta-${timestamp}`;

  let projectAlpha: any = null;
  let projectBeta: any = null;

  try {
    // ------------------------------------------------------------------------
    // Step 0: Bootstrap Test NestJS Application
    // ------------------------------------------------------------------------
    console.log('0️⃣ Bootstrapping NestJS application for Socket.IO call signaling...');
    app = await NestFactory.create(AppModule, { logger: ['warn', 'error'] });
    await app.listen(0);
    const httpServer = app.getHttpServer();
    const address = httpServer.address();
    const port = typeof address === 'string' ? address : address.port;
    serverUrl = `http://localhost:${port}`;
    console.log(`   ✅ Test NestJS Server running at ${serverUrl}\n`);

    const callSignalingService = app.get(CallSignalingService);

    // ------------------------------------------------------------------------
    // Step 1: Create Projects, Users, Conversations
    // ------------------------------------------------------------------------
    console.log('1️⃣ Setting up multi-tenant test fixtures...');
    projectAlpha = await projectService.create({
      name: 'Project Alpha (Calling)',
      slug: slugAlpha,
    });
    projectBeta = await projectService.create({
      name: 'Project Beta (Calling)',
      slug: slugBeta,
    });

    // Users in Alpha
    const alice = await commUserService.sync(projectAlpha.id, {
      externalId: `alice_call_${timestamp}`,
      name: 'Alice Call',
      email: 'alice@call.test',
      avatar: 'https://avatar.test/alice.png',
    });
    const bob = await commUserService.sync(projectAlpha.id, {
      externalId: `bob_call_${timestamp}`,
      name: 'Bob Call',
      email: 'bob@call.test',
      avatar: 'https://avatar.test/bob.png',
    });
    const charlie = await commUserService.sync(projectAlpha.id, {
      externalId: `charlie_call_${timestamp}`,
      name: 'Charlie Call',
      email: 'charlie@call.test',
    });
    const diana = await commUserService.sync(projectAlpha.id, {
      externalId: `diana_call_${timestamp}`,
      name: 'Diana Outsider',
      email: 'diana@call.test',
    });

    // User in Beta
    const borisBeta = await commUserService.sync(projectBeta.id, {
      externalId: `boris_call_${timestamp}`,
      name: 'Boris Beta',
      email: 'boris@call.test',
    });

    // 1-to-1 Conversation: Alice <-> Bob
    const directAliceBob = await conversationService.createDirect(
      projectAlpha.id,
      alice.id,
      bob.id,
    );

    // 1-to-1 Conversation: Charlie <-> Bob
    const directCharlieBob = await conversationService.createDirect(
      projectAlpha.id,
      charlie.id,
      bob.id,
    );

    // 1-to-1 Conversation: Charlie <-> Alice
    const directCharlieAlice = await conversationService.createDirect(
      projectAlpha.id,
      charlie.id,
      alice.id,
    );

    // Group Conversation in Alpha: Alice, Bob, Charlie
    const groupAlpha = await conversationService.createGroup(
      projectAlpha.id,
      alice.id,
      {
        title: 'Group Calling Test',
        participantIds: [bob.id, charlie.id],
      },
    );

    console.log('   ✅ Fixtures created:');
    console.log(`      - Direct Alice-Bob: ${directAliceBob.id}`);
    console.log(`      - Direct Charlie-Bob: ${directCharlieBob.id}`);
    console.log(`      - Group Alpha: ${groupAlpha.id}\n`);

    // ------------------------------------------------------------------------
    // Step 2: Establish Client Socket Connections
    // ------------------------------------------------------------------------
    console.log('2️⃣ Connecting authenticated client sockets (including multi-device simulation)...');

    // Alice: 1 socket
    const socketAlice = createClientSocket(serverUrl, {
      auth: { projectId: projectAlpha.id, userId: alice.id },
    });
    activeSockets.push(socketAlice);
    await waitForConnect(socketAlice);

    // Bob: 2 sockets (multi-device: e.g. Desktop + Mobile)
    const socketBobDesktop = createClientSocket(serverUrl, {
      auth: { projectId: projectAlpha.id, userId: bob.id },
    });
    activeSockets.push(socketBobDesktop);
    await waitForConnect(socketBobDesktop);

    const socketBobMobile = createClientSocket(serverUrl, {
      auth: { projectId: projectAlpha.id, userId: bob.id },
    });
    activeSockets.push(socketBobMobile);
    await waitForConnect(socketBobMobile);

    // Charlie: 1 socket
    const socketCharlie = createClientSocket(serverUrl, {
      auth: { projectId: projectAlpha.id, userId: charlie.id },
    });
    activeSockets.push(socketCharlie);
    await waitForConnect(socketCharlie);

    // Diana: 1 socket
    const socketDiana = createClientSocket(serverUrl, {
      auth: { projectId: projectAlpha.id, userId: diana.id },
    });
    activeSockets.push(socketDiana);
    await waitForConnect(socketDiana);

    // Boris Beta: 1 socket
    const socketBoris = createClientSocket(serverUrl, {
      auth: { projectId: projectBeta.id, userId: borisBeta.id },
    });
    activeSockets.push(socketBoris);
    await waitForConnect(socketBoris);

    console.log('   ✅ All sockets authenticated and connected.\n');

    // ========================================================================
    // Scenario 1: CALL START & FAN-OUT TO MULTIPLE DEVICES
    // ========================================================================
    console.log('📞 Scenario 1: Call Start & Multi-Device Fan-out...');

    // Prepare listeners on both of Bob's sockets
    const bobDesktopIncomingPromise = waitForEvent<CallIncomingPayload>(
      socketBobDesktop,
      REALTIME_EVENTS.SERVER.CALL_INCOMING,
    );
    const bobMobileIncomingPromise = waitForEvent<CallIncomingPayload>(
      socketBobMobile,
      REALTIME_EVENTS.SERVER.CALL_INCOMING,
    );

    // Alice initiates call
    const startCallAck = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.CALL_START,
      {
        conversationId: directAliceBob.id,
        callType: 'VIDEO',
      },
    );

    if (!startCallAck.success || !startCallAck.data?.callId) {
      throw new Error(`❌ call:start failed: ${JSON.stringify(startCallAck)}`);
    }
    if (startCallAck.data.status !== CallState.RINGING) {
      throw new Error(`❌ Expected status RINGING, got ${startCallAck.data.status}`);
    }
    const currentCallId = startCallAck.data.callId;
    console.log(`   ✅ Alice received ack with callId: ${currentCallId}, status: RINGING`);

    // Verify both of Bob's devices received the incoming call event
    const [desktopIncoming, mobileIncoming] = await Promise.all([
      bobDesktopIncomingPromise,
      bobMobileIncomingPromise,
    ]);

    if (desktopIncoming.callId !== currentCallId || mobileIncoming.callId !== currentCallId) {
      throw new Error('❌ Call ID mismatch in call:incoming payload');
    }
    if (desktopIncoming.conversationId !== directAliceBob.id) {
      throw new Error('❌ Conversation ID mismatch in call:incoming');
    }
    if (desktopIncoming.caller.id !== alice.id || desktopIncoming.caller.name !== 'Alice Call') {
      throw new Error('❌ Caller details mismatch in call:incoming');
    }
    if (desktopIncoming.callType !== 'VIDEO') {
      throw new Error('❌ CallType mismatch in call:incoming');
    }
    console.log('   ✅ Multi-device fan-out verified: Both Bob Desktop & Bob Mobile received call:incoming');

    // Verify outsider Diana and cross-project Boris did NOT receive call:incoming
    await Promise.all([
      expectNoEvent(socketDiana, REALTIME_EVENTS.SERVER.CALL_INCOMING, 300),
      expectNoEvent(socketBoris, REALTIME_EVENTS.SERVER.CALL_INCOMING, 300),
    ]);
    console.log('   ✅ Multi-tenant isolation verified: Outsiders received zero call notifications');

    // ========================================================================
    // Scenario 2: CALL ACCEPTANCE & OTHER DEVICE NOTIFICATION
    // ========================================================================
    console.log('\n📞 Scenario 2: Call Acceptance...');

    // Listeners for call:accepted
    const aliceAcceptedPromise = waitForEvent<CallAcceptedPayload>(
      socketAlice,
      REALTIME_EVENTS.SERVER.CALL_ACCEPTED,
    );
    const bobMobileAcceptedPromise = waitForEvent<CallAcceptedPayload>(
      socketBobMobile,
      REALTIME_EVENTS.SERVER.CALL_ACCEPTED,
    );

    // Bob accepts on Desktop
    const acceptAck = await emitWithAck(
      socketBobDesktop,
      REALTIME_EVENTS.CLIENT.CALL_ACCEPT,
      { callId: currentCallId },
    );

    if (!acceptAck.success || acceptAck.data?.status !== CallState.ACCEPTED) {
      throw new Error(`❌ call:accept failed: ${JSON.stringify(acceptAck)}`);
    }
    console.log('   ✅ Bob Desktop received accept ack with status: ACCEPTED');

    // Verify Alice was notified
    const aliceAccepted = await aliceAcceptedPromise;
    if (aliceAccepted.callId !== currentCallId || aliceAccepted.acceptedBy !== bob.id) {
      throw new Error('❌ Alice call:accepted payload invalid');
    }
    console.log('   ✅ Alice received call:accepted event');

    // Verify Bob Mobile was also notified to stop ringing
    const bobMobileAccepted = await bobMobileAcceptedPromise;
    if (bobMobileAccepted.callId !== currentCallId || bobMobileAccepted.acceptedBy !== bob.id) {
      throw new Error('❌ Bob Mobile did not receive call:accepted event');
    }
    console.log('   ✅ Bob Mobile received call:accepted event to dismiss ringing UI');

    // ========================================================================
    // Scenario 3: CALL END & CLEANUP
    // ========================================================================
    console.log('\n📞 Scenario 3: Call Termination & State Reset...');

    const bobDesktopEndPromise = waitForEvent<CallEndedPayload>(
      socketBobDesktop,
      REALTIME_EVENTS.SERVER.CALL_ENDED,
    );
    const bobMobileEndPromise = waitForEvent<CallEndedPayload>(
      socketBobMobile,
      REALTIME_EVENTS.SERVER.CALL_ENDED,
    );

    // Alice ends the call
    const endAck = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.CALL_END,
      { callId: currentCallId },
    );

    if (!endAck.success || endAck.data?.status !== CallState.ENDED) {
      throw new Error(`❌ call:end failed: ${JSON.stringify(endAck)}`);
    }
    console.log('   ✅ Alice received end ack with status: ENDED');

    const [bobDesktopEnded, bobMobileEnded] = await Promise.all([
      bobDesktopEndPromise,
      bobMobileEndPromise,
    ]);

    if (bobDesktopEnded.callId !== currentCallId || bobDesktopEnded.endedBy !== alice.id) {
      throw new Error('❌ Bob Desktop call:ended payload invalid');
    }
    if (bobMobileEnded.callId !== currentCallId || bobMobileEnded.endedBy !== alice.id) {
      throw new Error('❌ Bob Mobile call:ended payload invalid');
    }
    console.log('   ✅ Both of Bob\'s devices received call:ended event');

    // Verify both are now free to start a new call
    const testCallAck = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.CALL_START,
      { conversationId: directAliceBob.id, callType: 'AUDIO' },
    );
    if (!testCallAck.success) {
      throw new Error('❌ State cleanup failed: Alice unable to start a new call after ending previous');
    }
    // Clean up test call
    await emitWithAck(socketAlice, REALTIME_EVENTS.CLIENT.CALL_CANCEL, {
      callId: testCallAck.data.callId,
    });
    console.log('   ✅ User busy states properly cleared after call end');

    // ========================================================================
    // Scenario 4: CALL REJECTION
    // ========================================================================
    console.log('\n📞 Scenario 4: Call Rejection...');

    // Alice starts call
    const callRejectStartAck = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.CALL_START,
      { conversationId: directAliceBob.id, callType: 'AUDIO' },
    );
    const rejectCallId = callRejectStartAck.data.callId;

    const aliceRejectedPromise = waitForEvent<CallRejectedPayload>(
      socketAlice,
      REALTIME_EVENTS.SERVER.CALL_REJECTED,
    );
    const bobMobileRejectedPromise = waitForEvent<CallRejectedPayload>(
      socketBobMobile,
      REALTIME_EVENTS.SERVER.CALL_REJECTED,
    );

    // Bob rejects on Desktop
    const rejectAck = await emitWithAck(
      socketBobDesktop,
      REALTIME_EVENTS.CLIENT.CALL_REJECT,
      { callId: rejectCallId },
    );

    if (!rejectAck.success || rejectAck.data?.status !== CallState.REJECTED) {
      throw new Error(`❌ call:reject failed: ${JSON.stringify(rejectAck)}`);
    }

    const aliceRejected = await aliceRejectedPromise;
    if (aliceRejected.callId !== rejectCallId || aliceRejected.rejectedBy !== bob.id) {
      throw new Error('❌ Alice call:rejected payload invalid');
    }
    console.log('   ✅ Alice received call:rejected event');

    const bobMobileRejected = await bobMobileRejectedPromise;
    if (bobMobileRejected.callId !== rejectCallId) {
      throw new Error('❌ Bob Mobile did not receive call:rejected event');
    }
    console.log('   ✅ Bob Mobile received call:rejected event');

    // ========================================================================
    // Scenario 5: CALL CANCELLATION
    // ========================================================================
    console.log('\n📞 Scenario 5: Call Cancellation by Caller...');

    // Alice starts call
    const callCancelStartAck = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.CALL_START,
      { conversationId: directAliceBob.id, callType: 'VIDEO' },
    );
    const cancelCallId = callCancelStartAck.data.callId;

    const bobCancelPromise = waitForEvent<CallCancelledPayload>(
      socketBobDesktop,
      REALTIME_EVENTS.SERVER.CALL_CANCELLED,
    );

    // Alice cancels before Bob answers
    const cancelAck = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.CALL_CANCEL,
      { callId: cancelCallId },
    );

    if (!cancelAck.success || cancelAck.data?.status !== CallState.CANCELLED) {
      throw new Error(`❌ call:cancel failed: ${JSON.stringify(cancelAck)}`);
    }

    const bobCancelled = await bobCancelPromise;
    if (bobCancelled.callId !== cancelCallId || bobCancelled.cancelledBy !== alice.id) {
      throw new Error('❌ Bob received invalid call:cancelled event');
    }
    console.log('   ✅ Bob received call:cancelled event');

    // ========================================================================
    // Scenario 6: BUSY STATE HANDLING
    // ========================================================================
    console.log('\n📞 Scenario 6: Busy State Handling...');

    // 1. Alice calls Bob -> call is ringing
    const ringingCallAck = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.CALL_START,
      { conversationId: directAliceBob.id, callType: 'VIDEO' },
    );
    const activeRingingId = ringingCallAck.data.callId;

    // 2. Charlie attempts to call Bob while Bob is ringing
    const charlieBusyPromise = waitForEvent<CallBusyPayload>(
      socketCharlie,
      REALTIME_EVENTS.SERVER.CALL_BUSY,
    );

    const charlieStartAck = await emitWithAck(
      socketCharlie,
      REALTIME_EVENTS.CLIENT.CALL_START,
      { conversationId: directCharlieBob.id, callType: 'VIDEO' },
    );

    if (!charlieStartAck.success || charlieStartAck.data?.status !== CallState.BUSY) {
      throw new Error(`❌ Expected busy ack for Charlie, got ${JSON.stringify(charlieStartAck)}`);
    }

    const charlieBusyEvent = await charlieBusyPromise;
    if (charlieBusyEvent.userId !== bob.id) {
      throw new Error(`❌ Expected busy user to be Bob (${bob.id}), got ${charlieBusyEvent.userId}`);
    }
    console.log('   ✅ Charlie received call:busy event and BUSY ack when calling Bob');

    // 3. Charlie attempts to call Alice (who is already caller in active ringing call)
    const charlieAliceAck = await emitWithAck(
      socketCharlie,
      REALTIME_EVENTS.CLIENT.CALL_START,
      { conversationId: directCharlieAlice.id, callType: 'VIDEO' },
    );
    if (!charlieAliceAck.success || charlieAliceAck.data?.status !== CallState.BUSY) {
      throw new Error('❌ Expected Charlie calling Alice to return busy since Alice is in a call');
    }
    console.log('   ✅ Charlie received BUSY when calling Alice while Alice is calling Bob');

    // 4. Clean up active call between Alice and Bob
    await emitWithAck(socketAlice, REALTIME_EVENTS.CLIENT.CALL_CANCEL, {
      callId: activeRingingId,
    });

    // 5. Now Charlie calling Bob succeeds!
    const charlieBobRetryAck = await emitWithAck(
      socketCharlie,
      REALTIME_EVENTS.CLIENT.CALL_START,
      { conversationId: directCharlieBob.id, callType: 'VIDEO' },
    );
    if (!charlieBobRetryAck.success || charlieBobRetryAck.data?.status !== CallState.RINGING) {
      throw new Error('❌ Charlie calling Bob should succeed after previous call cancelled');
    }
    console.log('   ✅ After previous call cancelled, Bob is free and Charlie can call him');

    // Clean up Charlie-Bob call
    await emitWithAck(socketCharlie, REALTIME_EVENTS.CLIENT.CALL_CANCEL, {
      callId: charlieBobRetryAck.data.callId,
    });

    // ========================================================================
    // Scenario 7: RINGING TIMEOUT
    // ========================================================================
    console.log('\n📞 Scenario 7: Ringing Timeout Handling...');

    // Set a short ringing timeout: 1.2 seconds for testing
    callSignalingService.setTimeoutDuration(1200);

    const aliceTimeoutPromise = waitForEvent<CallEndedPayload>(
      socketAlice,
      REALTIME_EVENTS.SERVER.CALL_ENDED,
      3000,
    );
    const bobTimeoutPromise = waitForEvent<CallEndedPayload>(
      socketBobDesktop,
      REALTIME_EVENTS.SERVER.CALL_ENDED,
      3000,
    );

    const timeoutCallAck = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.CALL_START,
      { conversationId: directAliceBob.id, callType: 'AUDIO' },
    );
    const timedOutCallId = timeoutCallAck.data.callId;

    console.log('   ⏳ Waiting for 1.2s timeout to trigger automatically...');
    const [aliceTimeoutEvent, bobTimeoutEvent] = await Promise.all([
      aliceTimeoutPromise,
      bobTimeoutPromise,
    ]);

    if (aliceTimeoutEvent.callId !== timedOutCallId || aliceTimeoutEvent.reason !== 'TIMEOUT') {
      throw new Error(`❌ Alice timeout event mismatch: ${JSON.stringify(aliceTimeoutEvent)}`);
    }
    if (bobTimeoutEvent.callId !== timedOutCallId || bobTimeoutEvent.reason !== 'TIMEOUT') {
      throw new Error(`❌ Bob timeout event mismatch: ${JSON.stringify(bobTimeoutEvent)}`);
    }
    console.log('   ✅ Automatic ringing timeout correctly fired call:ended with reason: TIMEOUT to both parties');

    // Reset timeout duration back to 30000ms
    callSignalingService.setTimeoutDuration(30000);

    // ========================================================================
    // Scenario 8: AUTHORIZATION, VALIDATION & MULTI-TENANT ISOLATION
    // ========================================================================
    console.log('\n📞 Scenario 8: Authorization, Validation & Multi-Tenant Isolation...');

    // 1. Non-member (Diana) cannot start call in Alice-Bob conversation
    const dianaStartAck = await emitWithAck(
      socketDiana,
      REALTIME_EVENTS.CLIENT.CALL_START,
      { conversationId: directAliceBob.id, callType: 'VIDEO' },
    );
    if (dianaStartAck.success) {
      throw new Error('❌ Non-member was able to start a call in a conversation they do not belong to!');
    }
    console.log(`   ✅ Non-member prevented from starting call: ${dianaStartAck.error?.message}`);

    // 2. Cross-project user (Boris Beta) cannot call in Alpha conversation
    const borisStartAck = await emitWithAck(
      socketBoris,
      REALTIME_EVENTS.CLIENT.CALL_START,
      { conversationId: directAliceBob.id, callType: 'VIDEO' },
    );
    if (borisStartAck.success) {
      throw new Error('❌ Cross-project user was able to start call in another project!');
    }
    console.log(`   ✅ Cross-project user prevented: ${borisStartAck.error?.message}`);

    // 3. Group calling rejected (Phase 2 constraint)
    const groupCallAck = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.CALL_START,
      { conversationId: groupAlpha.id, callType: 'VIDEO' },
    );
    if (groupCallAck.success) {
      throw new Error('❌ Group calling should be rejected in Phase 2!');
    }
    if (!groupCallAck.error?.message.includes('Group calling is not supported')) {
      throw new Error(`❌ Expected group calling error message, got ${groupCallAck.error?.message}`);
    }
    console.log('   ✅ Group calling correctly rejected with proper explanation');

    // 4. Invalid transition: cannot accept a non-existent or cancelled call
    const badAcceptAck = await emitWithAck(
      socketBobDesktop,
      REALTIME_EVENTS.CLIENT.CALL_ACCEPT,
      { callId: 'call_non_existent_99999' },
    );
    if (badAcceptAck.success) {
      throw new Error('❌ Accepting non-existent call should fail!');
    }
    console.log(`   ✅ Invalid call acceptance rejected: ${badAcceptAck.error?.message}`);

    // 5. Outsider cannot cancel someone else's call
    const startForCancelTest = await emitWithAck(
      socketAlice,
      REALTIME_EVENTS.CLIENT.CALL_START,
      { conversationId: directAliceBob.id, callType: 'VIDEO' },
    );
    const cancelTestCallId = startForCancelTest.data.callId;

    const dianaCancelAck = await emitWithAck(
      socketDiana,
      REALTIME_EVENTS.CLIENT.CALL_CANCEL,
      { callId: cancelTestCallId },
    );
    if (dianaCancelAck.success) {
      throw new Error('❌ Outsider was able to cancel someone else\'s call!');
    }
    console.log('   ✅ Outsider cannot cancel active call');

    // Clean up
    await emitWithAck(socketAlice, REALTIME_EVENTS.CLIENT.CALL_CANCEL, {
      callId: cancelTestCallId,
    });

    console.log('\n🎉 ALL 8 CALL PHASE 2 VERIFICATION SCENARIOS PASSED SUCCESSFULLY!');
  } finally {
    console.log('\n🧹 Cleaning up test artifacts...');
    for (const s of activeSockets) {
      if (s.connected) {
        s.disconnect();
      }
    }

    try {
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
          projectId: { in: [projectAlpha.id, projectBeta.id] },
        },
      });
      await prisma.project.deleteMany({
        where: { id: { in: [projectAlpha.id, projectBeta.id] } },
      });
    } catch {
      // Ignored during cleanup
    }

    if (app) {
      await app.close();
    }
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runCallPhase2Tests().catch((err) => {
    console.error('❌ Call Phase 2 verification failed:', err);
    process.exit(1);
  });
}
