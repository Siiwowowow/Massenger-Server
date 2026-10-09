require('dotenv').config({ quiet: true });
const { PrismaClient } = require('../src/generated/prisma');
const prisma = new PrismaClient();

async function main() {
  // Prisma schema cannot express an index on a nested JSON property.
  await prisma.$runCommandRaw({
    createIndexes: 'messages',
    indexes: [{
      name: 'message_client_id_lookup',
      key: { conversationId: 1, senderId: 1, 'metadata.clientMessageId': 1 },
    }],
  });
  console.log('Message retry lookup index is ready.');
}
main().catch((error) => {
  console.error('Unable to create message lookup index:', error.code || error.name);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
