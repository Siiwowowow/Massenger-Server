require('dotenv').config();
const { PrismaClient } = require('../src/generated/prisma');
const prisma = new PrismaClient();
async function main() {
  const projects = await prisma.project.findMany();
  console.log('Projects:', projects.map(p => ({ id: p.id, name: p.name, apiKey: p.apiKey, status: p.status })));
  const commUsers = await prisma.communicationUser.findMany();
  console.log('CommUsers:', commUsers.map(u => ({ id: u.id, name: u.name, externalId: u.externalId, projectId: u.projectId })));
  const convs = await prisma.conversation.findMany({ include: { participants: true } });
  console.log('Conversations:', convs.map(c => ({ id: c.id, projectId: c.projectId, participants: c.participants.map(p => p.userId) })));
  await prisma.$disconnect();
}
main().catch(console.error);
