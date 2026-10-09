require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MessageService } = require('../dist/app/modules/message/message.service');
const { MessageReceiptService } = require('../dist/app/modules/message/message-receipt.service');
const { RealtimePublisher } = require('../dist/app/modules/realtime/realtime-publisher.module');
const { PresenceService } = require('../dist/app/modules/realtime/presence/presence.service');
const { InMemoryPresenceStore } = require('../dist/app/modules/realtime/presence/in-memory-presence.store');
const alice = '111111111111111111111111', bob = '222222222222222222222222';
const conversationId = '333333333333333333333333', projectId = '444444444444444444444444';

test('concurrent socket/REST retries persist once and broadcast before metadata update', async () => {
  const messages = [], events = [];
  const prisma = {
    conversation: { findFirst: async () => ({ participants: [{ userId: alice }, { userId: bob }] }),
      update: async () => events.push('metadata') },
    message: {
      findRaw: async ({ filter }) => messages.filter((m) => m.metadata.clientMessageId === filter['metadata.clientMessageId']).map((m) => ({ _id: { $oid: m.id } })),
      findUnique: async ({ where }) => messages.find((m) => m.id === where.id),
      create: async ({ data }) => {
        const message = { ...data, id: '555555555555555555555555', createdAt: new Date(), updatedAt: new Date(), receipts: [] };
        messages.push(message); events.push('saved'); return message;
      },
    },
  };
  const publisher = { publish: async (_id, _event, payload, recipients) => {
    assert.deepEqual(recipients, [alice, bob]); assert.equal(payload.clientMessageId, 'client-one'); events.push('broadcast');
  } };
  const service = new MessageService(prisma, publisher);
  const dto = { content: 'Hello', clientMessageId: 'client-one' };
  const [a, b] = await Promise.all([service.sendMessage(projectId, conversationId, alice, dto), service.sendMessage(projectId, conversationId, alice, dto)]);
  assert.equal(a.id, b.id); assert.equal(messages.length, 1);
  assert.deepEqual(events, ['saved', 'broadcast', 'metadata']);
  const retry = await service.sendMessage(projectId, conversationId, alice, dto);
  assert.equal(retry.id, a.id); assert.equal(messages.length, 1);
  messages[0].receipts = [{ userId: bob, readAt: new Date(), deliveredAt: new Date() }];
  const seen = await service.sendMessage(projectId, conversationId, alice, dto);
  assert.equal(seen.status, 'READ'); assert.equal(seen.receipts.length, 1);
});

test('unauthorized sender cannot persist or publish', async () => {
  const service = new MessageService({ conversation: { findFirst: async () => ({ participants: [{ userId: bob }] }) } });
  await assert.rejects(service.sendMessage(projectId, conversationId, alice, { content: 'Forbidden' }));
});

test('publisher uses one union of personal and conversation rooms', async () => {
  const publisher = new RealtimePublisher({});
  let rooms, count = 0;
  publisher.bind({ to: (values) => { rooms = values; return { emit: () => count++ }; } });
  await publisher.publish(conversationId, 'message:new', {}, [alice, bob]);
  assert.deepEqual(rooms, [`conversation:${conversationId}`, `user:${alice}`, `user:${bob}`]);
  assert.equal(count, 1);
});

test('simultaneous delivery and read keep one receipt, read time and conversation id', async () => {
  let row;
  const prisma = {
    messageReceipt: {
      findUnique: async () => row ? { ...row } : null,
      upsert: async ({ create }) => { if (!row) row = { ...create, id: 'receipt' }; return { ...row }; },
      updateMany: async ({ where, data }) => { if (row && row.id === where.id && !row.readAt) Object.assign(row, data); return { count: 1 }; },
    },
    conversationParticipant: { updateMany: async () => ({ count: 1 }) },
  };
  const service = new MessageReceiptService(prisma);
  service.assertMessageAccess = async () => ({ senderId: alice, conversationId });
  const [delivered, read] = await Promise.all([
    service.markDelivered(projectId, '555555555555555555555555', bob),
    service.markRead(projectId, '555555555555555555555555', bob),
  ]);
  assert(row.readAt); assert(row.deliveredAt);
  assert.equal(delivered.conversationId, conversationId); assert.equal(read.conversationId, conversationId);
  const firstReadAt = row.readAt;
  const again = await service.markDelivered(projectId, '555555555555555555555555', bob);
  assert.equal(again.readAt, firstReadAt); assert.equal(again.conversationId, conversationId);
});

test('presence remains online until the last tab disconnects and preserves offline time', async () => {
  const store = new InMemoryPresenceStore();
  const user = { id: alice, isOnline: false, lastSeenAt: null, updatedAt: new Date() };
  const service = new PresenceService(store, { communicationUser: {
    update: async ({ data }) => Object.assign(user, data), findFirst: async () => user,
  } });
  await service.handleConnect(projectId, alice, 'tab-one');
  await service.handleConnect(projectId, alice, 'tab-two');
  assert.equal((await service.handleDisconnect('tab-one')).isTransition, false);
  assert.equal((await service.getPresence(projectId, alice)).isOnline, true);
  const offline = await service.handleDisconnect('tab-two');
  assert.equal(offline.presence.isOnline, false); assert(offline.presence.lastSeenAt);
  assert.equal((await service.getPresence(projectId, alice)).lastSeenAt, offline.presence.lastSeenAt);
});

test('two real sockets receive a durable message once, including a recipient outside the chat room', { timeout: 10000 }, async () => {
  const http = require('node:http');
  const { once } = require('node:events');
  const { Server } = require('socket.io');
  const { io } = require('socket.io-client');
  const server = http.createServer();
  const sockets = new Server(server);
  const publisher = new RealtimePublisher({});
  publisher.bind(sockets);
  const service = new MessageService({
    conversation: {
      findFirst: async () => ({ participants: [{ userId: alice }, { userId: bob }] }),
      update: async () => ({}),
    },
    message: { findRaw: async () => [], create: async ({ data }) => ({ ...data,
      id: '666666666666666666666666', createdAt: new Date(), updatedAt: new Date(), receipts: [] }) },
  }, publisher);
  sockets.on('connection', (socket) => {
    socket.join(`user:${socket.handshake.auth.userId}`);
    if (socket.handshake.auth.userId === alice) socket.join(`conversation:${conversationId}`);
    socket.on('message:send', async (payload, ack) => {
      const message = await service.sendMessage(projectId, conversationId, alice, payload);
      ack({ success: true, data: message });
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const sender = io(url, { transports: ['websocket'], reconnection: false, auth: { userId: alice } });
  const receiver = io(url, { transports: ['websocket'], reconnection: false, auth: { userId: bob } });
  try {
    await Promise.all([once(sender, 'connect'), once(receiver, 'connect')]);
    let senderCount = 0, receiverCount = 0;
    sender.on('message:new', () => senderCount++);
    receiver.on('message:new', () => receiverCount++);
    const received = once(receiver, 'message:new');
    const ack = new Promise((resolve) => sender.emit('message:send', { content: 'Instant fanout', clientMessageId: 'socket-one' }, resolve));
    const [[message], response] = await Promise.all([received, ack]);
    assert.equal(message.content, 'Instant fanout'); assert.equal(response.success, true);
    assert.equal(message.id, response.data.id); assert.equal(message.clientMessageId, 'socket-one');
    assert.equal(senderCount, 1); assert.equal(receiverCount, 1);
  } finally {
    sender.disconnect(); receiver.disconnect();
    await new Promise((resolve) => sockets.close(resolve));
  }
});
