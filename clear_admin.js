const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearAdminData() {
  console.log("Clearing Admin Notifications...");
  
  const notifRes = await prisma.notification.deleteMany({});
  console.log(`Deleted ${notifRes.count} Notifications.`);

  const supportRes = await prisma.supportRequest.deleteMany({});
  console.log(`Deleted ${supportRes.count} Support Requests.`);

  const pendingRes = await prisma.pendingApproval.deleteMany({});
  console.log(`Deleted ${pendingRes.count} Pending Approvals.`);

  const auditRes = await prisma.auditLog.deleteMany({});
  console.log(`Deleted ${auditRes.count} Audit Logs.`);

  console.log("Admin Data Cleared.");
}

clearAdminData().catch(console.error).finally(() => prisma.$disconnect());
