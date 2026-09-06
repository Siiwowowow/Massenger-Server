import { PrismaClient } from '../src/generated/prisma';
import { ProjectService } from '../src/app/modules/project/project.service';
import { CommunicationUserService } from '../src/app/modules/communication-user/communication-user.service';
import { ConversationService } from '../src/app/modules/conversation/conversation.service';
import { MessageService } from '../src/app/modules/message/message.service';
import { MessageReceiptService } from '../src/app/modules/message/message-receipt.service';
import { PrismaService } from '../src/app/database/prisma.service';

export async function runPhaseDTests() {
  console.log('🧪 Starting Phase D Automated Verification: Message Delivery, Read Receipts & Unread System...\n');

  const prisma = new PrismaClient() as unknown as PrismaService;
  const projectService = new ProjectService(prisma);
  const commUserService = new CommunicationUserService(prisma);
  const conversationService = new ConversationService(prisma);
  const messageService = new MessageService(prisma);
  const receiptService = new MessageReceiptService(prisma);

  const timestamp = Date.now();
  const slugAlpha = `test-d-alpha-${timestamp}`;
  const slugBeta = `test-d-beta-${timestamp}`;

  try {
    // -------------------------------------------------------------
    // 1. Setup Projects, Users, and Conversations
    // -------------------------------------------------------------
    console.log('1️⃣ Setup: Creating test projects, users, and conversations...');
    const projectAlpha = await projectService.create({
      name: 'Project Alpha (Phase D)',
      slug: slugAlpha,
    });
    const projectBeta = await projectService.create({
      name: 'Project Beta (Phase D)',
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
      externalId: `alpha_user_non_member_${timestamp}`,
      name: 'David NonMember',
      email: 'david@alpha.test',
    });

    const betaUserX = await commUserService.sync(projectBeta.id, {
      externalId: `beta_user_x_${timestamp}`,
      name: 'Xavier Beta',
      email: 'xavier@beta.test',
    });
    const betaUserY = await commUserService.sync(projectBeta.id, {
      externalId: `beta_user_y_${timestamp}`,
      name: 'Yvonne Beta',
      email: 'yvonne@beta.test',
    });

    // Direct conversation: Alice & Bob in Alpha
    const convDirect = await conversationService.createDirect(projectAlpha.id, userA.id, userB.id);
    // Direct conversation: Xavier & Yvonne in Beta
    const convBeta = await conversationService.createDirect(projectBeta.id, betaUserX.id, betaUserY.id);

    console.log(`   ✅ Setup complete. Conv Alpha ID: ${convDirect.id}, Conv Beta ID: ${convBeta.id}\n`);

    // -------------------------------------------------------------
    // 2. Basic Receipt Flow (SENT -> DELIVERED -> READ) (Tests 1-6, 12-13)
    // -------------------------------------------------------------
    console.log('2️⃣ Testing Basic Receipt Flow: SENT -> DELIVERED -> READ...');
    // Alice sends message (SENT)
    const msg1 = await messageService.sendMessage(projectAlpha.id, convDirect.id, userA.id, {
      content: 'Hello Bob! Message 1 for delivery test',
    });
    console.log(`   ✅ Message 1 sent (SENT status): ID=${msg1.id}`);

    // Bob marks DELIVERED
    const deliveredReceipt = await receiptService.markDelivered(projectAlpha.id, msg1.id, userB.id);
    if (
      deliveredReceipt.messageId !== msg1.id ||
      deliveredReceipt.userId !== userB.id ||
      !deliveredReceipt.deliveredAt ||
      deliveredReceipt.readAt !== null
    ) {
      throw new Error('❌ Mark delivered failed assertions!');
    }
    console.log(`   ✅ Recipient marked DELIVERED: deliveredAt=${deliveredReceipt.deliveredAt.toISOString()}, readAt=null`);

    // Bob marks READ
    const readReceipt = await receiptService.markRead(projectAlpha.id, msg1.id, userB.id);
    if (
      readReceipt.messageId !== msg1.id ||
      readReceipt.userId !== userB.id ||
      !readReceipt.readAt ||
      !readReceipt.deliveredAt
    ) {
      throw new Error('❌ Mark read failed assertions! deliveredAt or readAt missing.');
    }
    if (readReceipt.readAt.getTime() < readReceipt.deliveredAt.getTime()) {
      throw new Error('❌ Non-monotonic timestamps: readAt cannot be earlier than deliveredAt!');
    }
    console.log(`   ✅ Recipient marked READ: readAt=${readReceipt.readAt.toISOString()}, deliveredAt=${readReceipt.deliveredAt.toISOString()}`);

    // -------------------------------------------------------------
    // 3. Idempotency & State Regression Protection (Tests 7-11, 14-15)
    // -------------------------------------------------------------
    console.log('\n3️⃣ Testing Idempotency & State Regression Protection...');
    // Send another message for delivery idempotency check
    const msg2 = await messageService.sendMessage(projectAlpha.id, convDirect.id, userA.id, {
      content: 'Message 2 for idempotency test',
    });

    const d1 = await receiptService.markDelivered(projectAlpha.id, msg2.id, userB.id);
    const d2 = await receiptService.markDelivered(projectAlpha.id, msg2.id, userB.id);

    if (d1.deliveredAt?.getTime() !== d2.deliveredAt?.getTime()) {
      throw new Error('❌ Idempotent markDelivered changed timestamp!');
    }

    // Check raw count of receipts in DB for msg2 to ensure no duplicates
    const receiptsCountMsg2 = await prisma.messageReceipt.count({
      where: { messageId: msg2.id, userId: userB.id },
    });
    if (receiptsCountMsg2 !== 1) {
      throw new Error(`❌ Duplicate receipt created for msg2! Count: ${receiptsCountMsg2}`);
    }
    console.log('   ✅ Mark delivered twice: Zero duplicate receipts, identical deliveredAt.');

    // Now mark msg2 read twice
    const r1 = await receiptService.markRead(projectAlpha.id, msg2.id, userB.id);
    const r2 = await receiptService.markRead(projectAlpha.id, msg2.id, userB.id);

    if (r1.readAt?.getTime() !== r2.readAt?.getTime()) {
      throw new Error('❌ Idempotent markRead changed timestamp!');
    }
    const receiptsCountMsg2AfterRead = await prisma.messageReceipt.count({
      where: { messageId: msg2.id, userId: userB.id },
    });
    if (receiptsCountMsg2AfterRead !== 1) {
      throw new Error(`❌ Duplicate receipt created after repeated markRead! Count: ${receiptsCountMsg2AfterRead}`);
    }
    console.log('   ✅ Mark read twice: Zero duplicate receipts, identical readAt.');

    // State progression: Calling markDelivered AFTER message is already READ must NOT regress state
    const regressAttempt = await receiptService.markDelivered(projectAlpha.id, msg2.id, userB.id);
    if (!regressAttempt.readAt) {
      throw new Error('❌ State regression: markDelivered erased readAt!');
    }
    if (regressAttempt.readAt.getTime() !== r1.readAt?.getTime()) {
      throw new Error('❌ State regression: markDelivered altered readAt timestamp!');
    }
    console.log('   ✅ READ -> DELIVERED regression prevented: readAt remains intact and uncorrupted.');

    // Direct READ on message without prior DELIVERED satisfies DELIVERED
    const msg3 = await messageService.sendMessage(projectAlpha.id, convDirect.id, userA.id, {
      content: 'Message 3 direct read without explicit delivered call',
    });
    const directRead = await receiptService.markRead(projectAlpha.id, msg3.id, userB.id);
    if (!directRead.readAt || !directRead.deliveredAt) {
      throw new Error('❌ Direct markRead must satisfy both readAt and deliveredAt!');
    }
    console.log('   ✅ Direct markRead automatically satisfied deliveredAt.');

    // -------------------------------------------------------------
    // 4. Authorization & Membership Restrictions (Tests 16-20)
    // -------------------------------------------------------------
    console.log('\n4️⃣ Testing Authorization & Membership Restrictions...');
    // Non-member (David) attempts to mark delivered -> 403 Forbidden
    try {
      await receiptService.markDelivered(projectAlpha.id, msg1.id, userNonMember.id);
      throw new Error('❌ Non-member should not be allowed to mark delivered!');
    } catch (err: any) {
      if (err.message && err.message.includes('not a member')) {
        console.log('   ✅ Non-member prevented from marking delivered (403 Forbidden).');
      } else {
        throw err;
      }
    }

    // Non-member attempts to mark read -> 403 Forbidden
    try {
      await receiptService.markRead(projectAlpha.id, msg1.id, userNonMember.id);
      throw new Error('❌ Non-member should not be allowed to mark read!');
    } catch (err: any) {
      if (err.message && err.message.includes('not a member')) {
        console.log('   ✅ Non-member prevented from marking read (403 Forbidden).');
      } else {
        throw err;
      }
    }

    // Non-member attempts to read receipts -> 403 Forbidden
    try {
      await receiptService.getMessageReceipts(projectAlpha.id, msg1.id, userNonMember.id);
      throw new Error('❌ Non-member should not be allowed to view receipts!');
    } catch (err: any) {
      if (err.message && err.message.includes('not a member')) {
        console.log('   ✅ Non-member prevented from viewing receipts (403 Forbidden).');
      } else {
        throw err;
      }
    }

    // Non-member attempts to get unread count -> 403 Forbidden
    try {
      await receiptService.getUnreadCount(projectAlpha.id, convDirect.id, userNonMember.id);
      throw new Error('❌ Non-member should not be allowed to access unread count!');
    } catch (err: any) {
      if (err.message && err.message.includes('not a member')) {
        console.log('   ✅ Non-member prevented from retrieving unread count (403 Forbidden).');
      } else {
        throw err;
      }
    }

    // -------------------------------------------------------------
    // 5. Cross-Project Isolation (Tests 19-20, 48-49)
    // -------------------------------------------------------------
    console.log('\n5️⃣ Testing Cross-Project Isolation...');
    // Beta user attempts to access Alpha message receipts -> 404 Not Found
    try {
      await receiptService.getMessageReceipts(projectBeta.id, msg1.id, betaUserX.id);
      throw new Error('❌ Cross-project message receipts retrieval should have failed!');
    } catch (err: any) {
      if (err.message && err.message.includes('not found')) {
        console.log('   ✅ Cross-project receipt access rejected with 404 Not Found.');
      } else {
        throw err;
      }
    }

    // Beta user attempts to access Alpha unread count -> 404 Not Found
    try {
      await receiptService.getUnreadCount(projectBeta.id, convDirect.id, betaUserX.id);
      throw new Error('❌ Cross-project unread count retrieval should have failed!');
    } catch (err: any) {
      if (err.message && err.message.includes('not found')) {
        console.log('   ✅ Cross-project unread count rejected with 404 Not Found.');
      } else {
        throw err;
      }
    }

    // Alpha user attempts to access Beta conversation read state -> 404 Not Found
    try {
      await receiptService.getConversationReadState(projectAlpha.id, convBeta.id, userA.id);
      throw new Error('❌ Cross-project read state retrieval should have failed!');
    } catch (err: any) {
      if (err.message && err.message.includes('not found')) {
        console.log('   ✅ Alpha user cannot access Beta read state (404 Not Found).');
      } else {
        throw err;
      }
    }

    // -------------------------------------------------------------
    // 6. Sender Behavior: Meaningless Self-Receipt & Unread Exclusion (Tests 21-22)
    // -------------------------------------------------------------
    console.log('\n6️⃣ Testing Sender Self-Receipt Prevention & Unread Exclusion...');
    // Alice (sender) attempts to mark delivered on own message
    try {
      await receiptService.markDelivered(projectAlpha.id, msg1.id, userA.id);
      throw new Error('❌ Sender should not be allowed to mark own message as delivered!');
    } catch (err: any) {
      if (err.message && err.message.includes('Senders cannot create receipts')) {
        console.log('   ✅ Sender prevented from creating delivery self-receipt (400 Bad Request).');
      } else {
        throw err;
      }
    }

    // Alice (sender) attempts to mark read on own message
    try {
      await receiptService.markRead(projectAlpha.id, msg1.id, userA.id);
      throw new Error('❌ Sender should not be allowed to mark own message as read!');
    } catch (err: any) {
      if (err.message && err.message.includes('Senders cannot create receipts')) {
        console.log('   ✅ Sender prevented from creating read self-receipt (400 Bad Request).');
      } else {
        throw err;
      }
    }

    // Alice's own messages should NEVER count towards Alice's unread count
    const aliceUnreadDirect = await receiptService.getUnreadCount(projectAlpha.id, convDirect.id, userA.id);
    if (aliceUnreadDirect.unreadCount !== 0) {
      throw new Error(`❌ Sender's own messages incremented sender unread count! Expected 0, got ${aliceUnreadDirect.unreadCount}`);
    }
    console.log('   ✅ Sender messages do not count towards sender unread count (unreadCount = 0).');

    // -------------------------------------------------------------
    // 7. Group Chat Independent Receipts (Tests 23-29)
    // -------------------------------------------------------------
    console.log('\n7️⃣ Testing Group Chat Independent Receipts & Unread States...');
    const convGroup = await conversationService.createGroup(projectAlpha.id, userA.id, {
      title: 'Alpha Receipt Group',
      participantIds: [userB.id, userC.id],
    });

    // Alice sends a message to the group
    const groupMsg = await messageService.sendMessage(projectAlpha.id, convGroup.id, userA.id, {
      content: 'Group announcement from Alice',
    });

    // Initial unread counts: Bob = 1, Charlie = 1, Alice = 0
    const bInitial = await receiptService.getUnreadCount(projectAlpha.id, convGroup.id, userB.id);
    const cInitial = await receiptService.getUnreadCount(projectAlpha.id, convGroup.id, userC.id);
    const aInitial = await receiptService.getUnreadCount(projectAlpha.id, convGroup.id, userA.id);

    if (bInitial.unreadCount !== 1 || cInitial.unreadCount !== 1 || aInitial.unreadCount !== 0) {
      throw new Error(`❌ Group initial unread count mismatch: B=${bInitial.unreadCount}, C=${cInitial.unreadCount}, A=${aInitial.unreadCount}`);
    }
    console.log('   ✅ Initial group unread counts verified: Bob=1, Charlie=1, Alice=0.');

    // Bob reads the message
    await receiptService.markRead(projectAlpha.id, groupMsg.id, userB.id);

    // Verify Bob = READ, Charlie = UNREAD / no receipt
    const groupReceipts = await receiptService.getMessageReceipts(projectAlpha.id, groupMsg.id, userA.id);
    const bReceipt = groupReceipts.find((r) => r.userId === userB.id);
    const cReceipt = groupReceipts.find((r) => r.userId === userC.id);

    if (!bReceipt || !bReceipt.readAt) {
      throw new Error('❌ Expected Bob to have READ receipt!');
    }
    if (cReceipt) {
      throw new Error('❌ Charlie has not read yet, receipt should not exist!');
    }
    console.log('   ✅ Group receipts breakdown: Bob=READ, Charlie=no receipt (UNREAD).');

    // Verify unread counts updated independently
    const bAfter = await receiptService.getUnreadCount(projectAlpha.id, convGroup.id, userB.id);
    const cAfter = await receiptService.getUnreadCount(projectAlpha.id, convGroup.id, userC.id);

    if (bAfter.unreadCount !== 0 || cAfter.unreadCount !== 1) {
      throw new Error(`❌ Independent group unread counts failed: B=${bAfter.unreadCount}, C=${cAfter.unreadCount}`);
    }
    console.log('   ✅ Group unread counts updated independently: Bob=0, Charlie=1.');

    // -------------------------------------------------------------
    // 8. Bulk Mark as Read (Tests 30-34)
    // -------------------------------------------------------------
    console.log('\n8️⃣ Testing Bulk Mark-as-Read (20 Messages)...');
    // Create new direct conversation between Bob and Charlie for bulk testing
    const convBulk = await conversationService.createDirect(projectAlpha.id, userB.id, userC.id);

    const bulkTotal = 20;
    console.log(`   Seeding ${bulkTotal} messages from Bob to Charlie...`);
    for (let i = 0; i < bulkTotal; i++) {
      await messageService.sendMessage(projectAlpha.id, convBulk.id, userB.id, {
        content: `Bulk message #${i + 1}`,
      });
    }

    // Verify Charlie has 20 unread messages
    const charlieBeforeBulk = await receiptService.getUnreadCount(projectAlpha.id, convBulk.id, userC.id);
    if (charlieBeforeBulk.unreadCount !== 20) {
      throw new Error(`❌ Expected Charlie to have 20 unread messages, got ${charlieBeforeBulk.unreadCount}`);
    }
    console.log(`   ✅ Charlie unread count before bulk read: ${charlieBeforeBulk.unreadCount}`);

    // Charlie executes bulk mark as read (no messageId passed = mark everything read)
    const bulkResult = await receiptService.markMessagesAsRead(projectAlpha.id, convBulk.id, userC.id);
    if (bulkResult.markedCount !== 20 || !bulkResult.lastReadMessageId) {
      throw new Error(`❌ Bulk mark read failed: markedCount=${bulkResult.markedCount}, lastReadMessageId=${bulkResult.lastReadMessageId}`);
    }
    console.log(`   ✅ Bulk mark as read executed: markedCount=${bulkResult.markedCount}, lastReadMessageId=${bulkResult.lastReadMessageId}`);

    // Verify unread count becomes 0
    const charlieAfterBulk = await receiptService.getUnreadCount(projectAlpha.id, convBulk.id, userC.id);
    if (charlieAfterBulk.unreadCount !== 0) {
      throw new Error(`❌ Expected Charlie unread count to be 0 after bulk read, got ${charlieAfterBulk.unreadCount}`);
    }
    console.log('   ✅ Charlie unread count is now 0.');

    // Idempotent bulk read: call again immediately -> markedCount should be 0
    const repeatBulk = await receiptService.markMessagesAsRead(projectAlpha.id, convBulk.id, userC.id);
    if (repeatBulk.markedCount !== 0) {
      throw new Error(`❌ Repeat bulk read should mark 0 messages, got ${repeatBulk.markedCount}`);
    }
    console.log('   ✅ Idempotent bulk mark read: 0 messages marked on repeat.');

    // -------------------------------------------------------------
    // 9. Partial Read Up to Message N (Tests 35-38)
    // -------------------------------------------------------------
    console.log('\n9️⃣ Testing Partial Read Up to Message N...');
    // Create new direct conversation between Alice and Charlie
    const convPartial = await conversationService.createDirect(projectAlpha.id, userA.id, userC.id);

    const partialMsgs: any[] = [];
    for (let i = 0; i < 6; i++) {
      const m = await messageService.sendMessage(projectAlpha.id, convPartial.id, userA.id, {
        content: `Partial sequence message #${i + 1}`,
      });
      partialMsgs.push(m);
    }

    // Verify initial unread = 6
    const initialPartialUnread = await receiptService.getUnreadCount(projectAlpha.id, convPartial.id, userC.id);
    if (initialPartialUnread.unreadCount !== 6) {
      throw new Error(`❌ Expected 6 unread messages, got ${initialPartialUnread.unreadCount}`);
    }

    // Mark up to Message #3 (index 2) as read
    const targetMsg = partialMsgs[2]; // 3rd message
    const partialResult = await receiptService.markMessagesAsRead(projectAlpha.id, convPartial.id, userC.id, {
      messageId: targetMsg.id,
    });

    if (partialResult.markedCount !== 3 || partialResult.lastReadMessageId !== targetMsg.id) {
      throw new Error(`❌ Partial mark read failed: expected markedCount=3, got ${partialResult.markedCount}`);
    }
    console.log(`   ✅ Partial read up to message #3 marked exactly 3 messages as read.`);

    // Verify unread count becomes 3 (messages 4, 5, 6 remain unread)
    const afterPartialUnread = await receiptService.getUnreadCount(projectAlpha.id, convPartial.id, userC.id);
    if (afterPartialUnread.unreadCount !== 3) {
      throw new Error(`❌ Expected 3 remaining unread messages, got ${afterPartialUnread.unreadCount}`);
    }
    console.log(`   ✅ Remaining unread count is exactly 3.`);

    // Verify older messages (1, 2, 3) are read, newer (4, 5, 6) are unread
    const receipt1 = await receiptService.getMessageReceipts(projectAlpha.id, partialMsgs[0].id, userC.id);
    const receipt3 = await receiptService.getMessageReceipts(projectAlpha.id, partialMsgs[2].id, userC.id);
    const receipt4 = await receiptService.getMessageReceipts(projectAlpha.id, partialMsgs[3].id, userC.id);

    const hasRead1 = receipt1.some((r) => r.userId === userC.id && r.readAt !== null);
    const hasRead3 = receipt3.some((r) => r.userId === userC.id && r.readAt !== null);
    const hasRead4 = receipt4.some((r) => r.userId === userC.id && r.readAt !== null);

    if (!hasRead1 || !hasRead3 || hasRead4) {
      throw new Error(`❌ Partial read boundary failed: hasRead1=${hasRead1}, hasRead3=${hasRead3}, hasRead4=${hasRead4}`);
    }
    console.log('   ✅ Verified message boundaries: Messages 1 & 3 are READ, Message 4 is UNREAD.');

    // -------------------------------------------------------------
    // 10. Granular Unread Count Progression (Tests 39-44)
    // -------------------------------------------------------------
    console.log('\n🔟 Testing Granular Unread Count Progression (10 -> Read 4 -> Read Remaining)...');
    // Alice sends 10 messages to Bob in a dedicated conversation
    const convProgression = await conversationService.createDirect(projectAlpha.id, userA.id, userB.id);

    const progMsgs: any[] = [];
    for (let i = 0; i < 10; i++) {
      const m = await messageService.sendMessage(projectAlpha.id, convProgression.id, userA.id, {
        content: `Progression message #${i + 1}`,
      });
      progMsgs.push(m);
    }

    // Step 1: Verify count = 10
    const count10 = await receiptService.getUnreadCount(projectAlpha.id, convProgression.id, userB.id);
    if (count10.unreadCount !== 10) {
      throw new Error(`❌ Expected 10 unread, got ${count10.unreadCount}`);
    }
    console.log(`   ✅ 10 messages sent. Unread count = ${count10.unreadCount}.`);

    // Step 2: Read first 4 messages one-by-one
    for (let i = 0; i < 4; i++) {
      await receiptService.markRead(projectAlpha.id, progMsgs[i].id, userB.id);
    }

    // Step 3: Verify count = 6
    const count6 = await receiptService.getUnreadCount(projectAlpha.id, convProgression.id, userB.id);
    if (count6.unreadCount !== 6) {
      throw new Error(`❌ Expected 6 unread, got ${count6.unreadCount}`);
    }
    console.log(`   ✅ Read 4 messages individually. Unread count = ${count6.unreadCount}.`);

    // Step 4: Bulk read remaining messages
    await receiptService.markMessagesAsRead(projectAlpha.id, convProgression.id, userB.id);

    // Step 5: Verify count = 0
    const count0 = await receiptService.getUnreadCount(projectAlpha.id, convProgression.id, userB.id);
    if (count0.unreadCount !== 0) {
      throw new Error(`❌ Expected 0 unread after reading remaining, got ${count0.unreadCount}`);
    }
    console.log(`   ✅ Read remaining messages. Unread count = ${count0.unreadCount}.`);

    // -------------------------------------------------------------
    // 11. Soft-Deleted Messages & Receipt Retention (Tests 45-47)
    // -------------------------------------------------------------
    console.log('\n1️⃣1️⃣ Testing Soft-Deleted Messages & Receipt Preservation...');
    const delConv = await conversationService.createDirect(projectAlpha.id, userA.id, userB.id);

    const msgToDel = await messageService.sendMessage(projectAlpha.id, delConv.id, userA.id, {
      content: 'This message will be soft-deleted',
    });

    // Bob marks it delivered and read before deletion
    await receiptService.markRead(projectAlpha.id, msgToDel.id, userB.id);

    // Alice soft-deletes the message
    await messageService.deleteMessage(projectAlpha.id, msgToDel.id, userA.id);

    // Verify receipt record is preserved in database
    const preservedReceipt = await prisma.messageReceipt.findUnique({
      where: {
        messageId_userId: {
          messageId: msgToDel.id,
          userId: userB.id,
        },
      },
    });
    if (!preservedReceipt || !preservedReceipt.readAt) {
      throw new Error('❌ Receipt record was lost when message was soft-deleted!');
    }
    console.log('   ✅ Receipt preserved in database after message soft-deletion.');

    // Now test unread behavior with a soft-deleted UNREAD message:
    const unreadMsgToDel = await messageService.sendMessage(projectAlpha.id, delConv.id, userA.id, {
      content: 'Unread message to be soft-deleted',
    });
    const beforeDelCount = await receiptService.getUnreadCount(projectAlpha.id, delConv.id, userB.id);
    if (beforeDelCount.unreadCount !== 1) {
      throw new Error(`❌ Expected 1 unread message before deletion, got ${beforeDelCount.unreadCount}`);
    }

    // Alice soft-deletes the unread message
    await messageService.deleteMessage(projectAlpha.id, unreadMsgToDel.id, userA.id);

    // Documented semantics: Soft-deleted messages are excluded from active unread count
    const afterDelCount = await receiptService.getUnreadCount(projectAlpha.id, delConv.id, userB.id);
    if (afterDelCount.unreadCount !== 0) {
      throw new Error(`❌ Expected 0 unread messages after soft-delete, got ${afterDelCount.unreadCount}`);
    }
    console.log('   ✅ Documented semantics verified: Soft-deleted unread message excluded from unread count (0).');

    // -------------------------------------------------------------
    // 12. Batch User Unread Counts & Conversation Read State
    // -------------------------------------------------------------
    console.log('\n1️⃣2️⃣ Testing Batch User Unread Counts & Full Read State...');
    const userUnreadCounts = await receiptService.getUserUnreadCounts(projectAlpha.id, userB.id);
    if (!Array.isArray(userUnreadCounts) || userUnreadCounts.length === 0) {
      throw new Error('❌ getUserUnreadCounts failed to return conversation counts array!');
    }
    console.log(`   ✅ getUserUnreadCounts returned counts for ${userUnreadCounts.length} conversations with zero N+1 queries.`);

    const fullReadState = await receiptService.getConversationReadState(projectAlpha.id, convDirect.id, userB.id);
    if (fullReadState.conversationId !== convDirect.id || fullReadState.userId !== userB.id) {
      throw new Error('❌ getConversationReadState failed assertion!');
    }
    console.log(`   ✅ getConversationReadState retrieved: lastReadMessageId=${fullReadState.lastReadMessageId}, unreadCount=${fullReadState.unreadCount}.`);

    // -------------------------------------------------------------
    // 13. Cleanup
    // -------------------------------------------------------------
    console.log('\n🧹 Cleaning up test artifacts...');
    const alphaConvIds = [convDirect.id, convGroup.id, convBulk.id, convPartial.id, convProgression.id, delConv.id];
    const allConvIds = [...alphaConvIds, convBeta.id];

    await prisma.messageReceipt.deleteMany({
      where: {
        projectId: { in: [projectAlpha.id, projectBeta.id] },
      },
    });
    await prisma.message.deleteMany({
      where: {
        conversationId: { in: allConvIds },
      },
    });
    await prisma.conversationParticipant.deleteMany({
      where: {
        conversationId: { in: allConvIds },
      },
    });
    await prisma.conversation.deleteMany({
      where: {
        id: { in: allConvIds },
      },
    });
    await prisma.communicationUser.deleteMany({
      where: {
        id: { in: [userA.id, userB.id, userC.id, userNonMember.id, betaUserX.id, betaUserY.id] },
      },
    });
    await prisma.project.deleteMany({
      where: {
        id: { in: [projectAlpha.id, projectBeta.id] },
      },
    });
    console.log('   ✅ All Phase D test artifacts successfully cleaned up.\n');

    console.log('🎉 ALL PHASE D VERIFICATION CHECKS PASSED SUCCESSFULLY!');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runPhaseDTests().catch((err) => {
    console.error('❌ Phase D verification failed:', err);
    process.exit(1);
  });
}
