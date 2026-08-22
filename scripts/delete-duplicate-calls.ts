import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  console.log("Finding duplicate calls...");
  
  // Find all callLogs with the same callLogId
  const allCalls = await prisma.callLog.findMany({
    select: { id: true, callLogId: true, companyId: true, direction: true, createdAt: true }
  });
  
  const grouped = new Map<string, any[]>();
  for (const c of allCalls) {
    if (!c.callLogId) continue;
    if (!grouped.has(c.callLogId)) grouped.set(c.callLogId, []);
    grouped.get(c.callLogId)!.push(c);
  }
  
  let deletedCount = 0;
  
  // We need to fetch all companies to know which are parents
  const companies = await prisma.company.findMany();
  const companyMap = new Map(companies.map(c => [c.id, c]));
  
  for (const [callLogId, calls] of grouped.entries()) {
    if (calls.length > 1) {
      console.log(`Found ${calls.length} duplicates for callLogId: ${callLogId}`);
      
      // Separate into child vs parent
      const childCalls = calls.filter(c => {
        const comp = companyMap.get(c.companyId);
        return comp && comp.parentCompanyId !== null;
      });
      
      const parentCalls = calls.filter(c => {
        const comp = companyMap.get(c.companyId);
        return comp && comp.parentCompanyId === null;
      });
      
      // If we have at least one child call, we can safely delete the parent calls
      if (childCalls.length > 0 && parentCalls.length > 0) {
        for (const pCall of parentCalls) {
          console.log(`Deleting redundant parent call log: ${pCall.id} (Company: ${pCall.companyId})`);
          try {
            await prisma.callLog.delete({ where: { id: pCall.id } });
            deletedCount++;
          } catch (e: any) {
            if (e.code !== 'P2025') throw e;
          }
        }
      } else if (parentCalls.length > 1) {
        // Just multiple parent calls? Keep the oldest one
        parentCalls.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        for (let i = 1; i < parentCalls.length; i++) {
          const pCall = parentCalls[i];
          console.log(`Deleting duplicate parent call log: ${pCall.id} (Company: ${pCall.companyId})`);
          try {
            await prisma.callLog.delete({ where: { id: pCall.id } });
            deletedCount++;
          } catch (e: any) {
            if (e.code !== 'P2025') throw e;
          }
        }
      }
    }
  }
  
  console.log(`Finished. Deleted ${deletedCount} redundant duplicate call logs.`);
}

main().finally(() => prisma.$disconnect());
