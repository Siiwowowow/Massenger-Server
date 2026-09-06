import { PrismaClient, MessageType } from '../src/generated/prisma';
import { ProjectService } from '../src/app/modules/project/project.service';
import { CommunicationUserService } from '../src/app/modules/communication-user/communication-user.service';
import { ConversationService } from '../src/app/modules/conversation/conversation.service';
import { MessageService } from '../src/app/modules/message/message.service';
import { PrismaService } from '../src/app/database/prisma.service';

export async function runPhaseCTests() {
  console.log('🧪 Starting Phase C Automated Verification: REST Messaging System...\n');

  const prisma = new PrismaClient() as unknown as PrismaService;
  const projectService = new ProjectService(prisma);
  const commUserService = new CommunicationUserService(prisma);
  const conversationService = new ConversationService(prisma);
  const messageService = new MessageService(prisma);

  const timestamp = Date.now();
  const slugAlpha = `test-c-alpha-${timestamp}`;
  const slugBeta = `test-c-beta-${timestamp}`;

  try {
    // 1. Setup Projects & Users
    console.log('1️⃣ Setup: Creating test projects, users, and conversations...');
    const projectAlpha = await projectService.create({
      name: 'Project Alpha (Phase C)',
      slug: slugAlpha,
    });
    const projectBeta = await projectService.create({
      name: 'Project Beta (Phase C)',
      slug: slugBeta,
    });

    const userA = await commUserService.sync(projectAlpha.id, {
      externalId: `alpha_user_a_${timestamp}`,
      name: 'Alice (Alpha)',
      email: 'alice@alpha.test',
    });
    const userB = await commUserService.sync(projectAlpha.id, {
      externalId: `alpha_user_b_${timestamp}`,
      name: 'Bob (Alpha)',
      email: 'bob@alpha.test',
    });
    const userC = await commUserService.sync(projectAlpha.id, {
      externalId: `alpha_user_c_${timestamp}`,
      name: 'Charlie NonMember (Alpha)',
      email: 'charlie@alpha.test',
    });

    const userX = await commUserService.sync(projectBeta.id, {
      externalId: `beta_user_x_${timestamp}`,
      name: 'Xavier (Beta)',
      email: 'xavier@beta.test',
    });
    const userY = await commUserService.sync(projectBeta.id, {
      externalId: `beta_user_y_${timestamp}`,
      name: 'Yvonne (Beta)',
      email: 'yvonne@beta.test',
    });

    const convAlpha = await conversationService.createDirect(projectAlpha.id, userA.id, userB.id);
    const convBeta = await conversationService.createDirect(projectBeta.id, userX.id, userY.id);

    console.log(`   ✅ Setup complete. Conversation Alpha ID: ${convAlpha.id}, Beta ID: ${convBeta.id}\n`);

    // 2. Send Message Test (Section 36)
    console.log('2️⃣ Testing Send Message...');
    const message1 = await messageService.sendMessage(projectAlpha.id, convAlpha.id, userA.id, {
      type: MessageType.TEXT,
      content: 'Hello Bob! This is message #1',
      metadata: { clientTempId: 'temp-001', priority: 'high' },
    });

    if (
      message1.senderId !== userA.id ||
      message1.conversationId !== convAlpha.id ||
      message1.content !== 'Hello Bob! This is message #1' ||
      message1.type !== MessageType.TEXT
    ) {
      throw new Error('❌ Send message response failed assertion!');
    }
    console.log(`   ✅ Message created: ID=${message1.id}, Sender=${message1.sender?.name}`);

    // Verify conversation lastMessageAt was updated
    const updatedConv = await conversationService.findById(projectAlpha.id, convAlpha.id, userA.id);
    if (!updatedConv.lastMessageAt) {
      throw new Error('❌ Conversation lastMessageAt was not updated!');
    }
    console.log('   ✅ Conversation lastMessageAt timestamp updated properly.');

    // 3. Non-Member Restrictions (Section 37)
    console.log('\n3️⃣ Testing Non-Member Access Control...');
    // C attempts to send message to Alpha conversation
    try {
      await messageService.sendMessage(projectAlpha.id, convAlpha.id, userC.id, {
        content: 'I should not be allowed here!',
      });
      throw new Error('❌ Non-member was able to send message!');
    } catch (err: any) {
      if (err.message && err.message.includes('not a member')) {
        console.log('   ✅ Non-member prevented from sending message (403 Forbidden).');
      } else {
        throw err;
      }
    }

    // C attempts to read message history
    try {
      await messageService.findMessages(projectAlpha.id, convAlpha.id, userC.id, { limit: 20 });
      throw new Error('❌ Non-member was able to read messages!');
    } catch (err: any) {
      if (err.message && err.message.includes('not a member')) {
        console.log('   ✅ Non-member prevented from reading message history (403 Forbidden).');
      } else {
        throw err;
      }
    }

    // C attempts to read single message
    try {
      await messageService.findMessageById(projectAlpha.id, message1.id, userC.id);
      throw new Error('❌ Non-member was able to get single message!');
    } catch (err: any) {
      if (err.message && err.message.includes('not a member')) {
        console.log('   ✅ Non-member prevented from retrieving single message (403 Forbidden).');
      } else {
        throw err;
      }
    }

    // 4. Cross-Project Isolation (Section 38)
    console.log('\n4️⃣ Testing Cross-Project Message Isolation...');
    // User X (Project Beta) sends message to Beta conversation
    const messageBeta = await messageService.sendMessage(projectBeta.id, convBeta.id, userX.id, {
      content: 'Hello from Beta!',
    });

    // User A (Project Alpha) attempts to get Beta message
    try {
      await messageService.findMessageById(projectAlpha.id, messageBeta.id, userA.id);
      throw new Error('❌ Cross-project message retrieval should have failed!');
    } catch (err: any) {
      if (err.message && err.message.includes('not found')) {
        console.log('   ✅ Alpha user cannot access Beta message (404 Not Found).');
      } else {
        throw err;
      }
    }

    // User X (Project Beta) attempts to read Alpha conversation messages
    try {
      await messageService.findMessages(projectBeta.id, convAlpha.id, userX.id, { limit: 20 });
      throw new Error('❌ Cross-project conversation messages retrieval should have failed!');
    } catch (err: any) {
      if (err.message && err.message.includes('not found')) {
        console.log('   ✅ Beta user cannot access Alpha conversation messages (404 Not Found).');
      } else {
        throw err;
      }
    }

    // 5. Message History with 50+ Messages & Cursor Pagination (Section 14, 15, 16, 39)
    console.log('\n5️⃣ Testing Cursor-based Pagination with 50+ Messages...');
    const bulkCount = 55;
    console.log(`   Seeding ${bulkCount} messages into Conversation Alpha...`);

    for (let i = 0; i < bulkCount; i++) {
      const sender = i % 2 === 0 ? userA.id : userB.id;
      await messageService.sendMessage(projectAlpha.id, convAlpha.id, sender, {
        content: `Bulk message #${i.toString().padStart(2, '0')}`,
      });
    }
    console.log(`   ✅ Seeded ${bulkCount} messages successfully.`);

    // Page 1: limit = 20, no cursor
    const page1 = await messageService.findMessages(projectAlpha.id, convAlpha.id, userA.id, {
      limit: 20,
    });
    if (page1.items.length !== 20 || !page1.hasMore || !page1.nextCursor) {
      throw new Error(`❌ Page 1 failed: expected 20 items, hasMore=true, nextCursor. Got length=${page1.items.length}, hasMore=${page1.hasMore}`);
    }
    console.log(`   ✅ Page 1 retrieved: 20 messages, nextCursor=${page1.nextCursor}, hasMore=true.`);

    // Page 2: limit = 20, cursor = page1.nextCursor
    const page2 = await messageService.findMessages(projectAlpha.id, convAlpha.id, userA.id, {
      limit: 20,
      cursor: page1.nextCursor,
    });
    if (page2.items.length !== 20 || !page2.hasMore || !page2.nextCursor) {
      throw new Error(`❌ Page 2 failed: expected 20 items, hasMore=true. Got length=${page2.items.length}, hasMore=${page2.hasMore}`);
    }
    console.log(`   ✅ Page 2 retrieved: 20 messages, nextCursor=${page2.nextCursor}, hasMore=true.`);

    // Page 3: limit = 20, cursor = page2.nextCursor
    const page3 = await messageService.findMessages(projectAlpha.id, convAlpha.id, userA.id, {
      limit: 20,
      cursor: page2.nextCursor,
    });
    // Total messages in convAlpha = 1 (message1) + 55 = 56. Page 1 had 20, Page 2 had 20, Page 3 should have remaining 16!
    if (page3.items.length !== 16 || page3.hasMore !== false || page3.nextCursor !== null) {
      throw new Error(`❌ Page 3 failed: expected 16 remaining items, hasMore=false, nextCursor=null. Got length=${page3.items.length}, hasMore=${page3.hasMore}, nextCursor=${page3.nextCursor}`);
    }
    console.log(`   ✅ Page 3 retrieved: ${page3.items.length} remaining messages, hasMore=false, nextCursor=null.`);

    // Verify no duplicates across all pages
    const allRetrievedIds = [
      ...page1.items.map((m) => m.id),
      ...page2.items.map((m) => m.id),
      ...page3.items.map((m) => m.id),
    ];
    const uniqueIds = new Set(allRetrievedIds);
    if (uniqueIds.size !== 56 || allRetrievedIds.length !== 56) {
      throw new Error(`❌ Pagination duplicate/missing detected! Total: ${allRetrievedIds.length}, Unique: ${uniqueIds.size}, Expected: 56`);
    }
    console.log('   ✅ Zero duplicates & zero missing messages verified across 3 cursor pages.');

    // 6. Edit Message Tests (Section 18, 40)
    console.log('\n6️⃣ Testing Message Editing & Permissions...');
    // User A edits their own message1
    const editedMsg = await messageService.updateMessage(projectAlpha.id, message1.id, userA.id, {
      content: 'Hello Bob! This is message #1 (Edited)',
    });
    if (editedMsg.content !== 'Hello Bob! This is message #1 (Edited)') {
      throw new Error('❌ Message content update failed!');
    }
    console.log('   ✅ Sender (User A) successfully edited own message.');

    // User B attempts to edit User A's message -> must fail
    try {
      await messageService.updateMessage(projectAlpha.id, message1.id, userB.id, {
        content: 'Bob trying to overwrite Alice',
      });
      throw new Error('❌ Non-sender should not be allowed to edit message!');
    } catch (err: any) {
      if (err.message && err.message.includes('Only the message sender')) {
        console.log('   ✅ Unauthorized edit prevented: Non-sender cannot edit (403 Forbidden).');
      } else {
        throw err;
      }
    }

    // 7. Delete Message Tests & Soft-Delete Content Hiding (Section 19, 20, 41)
    console.log('\n7️⃣ Testing Soft Deletion & Content Concealment...');
    // User B attempts to delete User A's message -> must fail
    try {
      await messageService.deleteMessage(projectAlpha.id, message1.id, userB.id);
      throw new Error('❌ Non-sender should not be allowed to delete message!');
    } catch (err: any) {
      if (err.message && err.message.includes('Only the message sender')) {
        console.log('   ✅ Unauthorized delete prevented: Non-sender cannot delete (403 Forbidden).');
      } else {
        throw err;
      }
    }

    // User A deletes their message
    const deleteResult = await messageService.deleteMessage(projectAlpha.id, message1.id, userA.id);
    console.log(`   ✅ Sender deleted message: ${deleteResult.message}`);

    // Verify record still exists in DB with deletedAt timestamp
    const rawDbMessage = await prisma.message.findUnique({ where: { id: message1.id } });
    if (!rawDbMessage || !rawDbMessage.deletedAt) {
      throw new Error('❌ Message was physically deleted or deletedAt is missing!');
    }
    console.log('   ✅ Soft deletion confirmed: Record preserved in database with deletedAt timestamp.');

    // Verify client-facing retrieval conceals content
    const fetchedDeletedMsg = await messageService.findMessageById(projectAlpha.id, message1.id, userA.id);
    if (fetchedDeletedMsg.content !== null || fetchedDeletedMsg.deletedAt === null) {
      throw new Error('❌ Deleted message content should be concealed (null) from client response!');
    }
    console.log('   ✅ Client-facing content concealment confirmed: content=null, deletedAt is exposed.');

    // Attempt to edit a deleted message -> must fail
    try {
      await messageService.updateMessage(projectAlpha.id, message1.id, userA.id, {
        content: 'Trying to resurrect deleted message',
      });
      throw new Error('❌ Editing a deleted message should have failed!');
    } catch (err: any) {
      if (err.message && err.message.includes('Deleted messages cannot be edited')) {
        console.log('   ✅ Editing deleted message prevented (400 Bad Request).');
      } else {
        throw err;
      }
    }

    // 8. Validation Rules (Section 43)
    console.log('\n8️⃣ Testing Input Validation...');
    // Invalid conversation ID format
    try {
      await messageService.findMessages(projectAlpha.id, 'invalid-non-hex-id', userA.id, { limit: 20 });
      throw new Error('❌ Invalid conversation ID should have failed!');
    } catch (err: any) {
      if (err.message && err.message.includes('Invalid conversation ID')) {
        console.log('   ✅ Invalid conversation ID rejected with Bad Request.');
      } else {
        throw err;
      }
    }

    // Invalid cursor format
    try {
      await messageService.findMessages(projectAlpha.id, convAlpha.id, userA.id, {
        limit: 20,
        cursor: 'invalid-cursor',
      });
      throw new Error('❌ Invalid cursor format should have failed!');
    } catch (err: any) {
      if (err.message && err.message.includes('Invalid cursor format')) {
        console.log('   ✅ Invalid cursor format rejected with Bad Request.');
      } else {
        throw err;
      }
    }

    // Non-existent cursor
    try {
      await messageService.findMessages(projectAlpha.id, convAlpha.id, userA.id, {
        limit: 20,
        cursor: '66e000000000000000000000',
      });
      throw new Error('❌ Non-existent cursor should have failed!');
    } catch (err: any) {
      if (err.message && err.message.includes('Cursor message not found')) {
        console.log('   ✅ Non-existent cursor rejected with Bad Request.');
      } else {
        throw err;
      }
    }

    // 9. Cleanup
    console.log('\n🧹 Cleaning up test artifacts...');
    await prisma.message.deleteMany({
      where: {
        conversationId: { in: [convAlpha.id, convBeta.id] },
      },
    });
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
        id: { in: [userA.id, userB.id, userC.id, userX.id, userY.id] },
      },
    });
    await prisma.project.deleteMany({
      where: {
        id: { in: [projectAlpha.id, projectBeta.id] },
      },
    });
    console.log('   ✅ All test artifacts successfully cleaned up.\n');

    console.log('🎉 ALL PHASE C VERIFICATION CHECKS PASSED SUCCESSFULLY!');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runPhaseCTests().catch((err) => {
    console.error('❌ Phase C verification failed:', err);
    process.exit(1);
  });
}
