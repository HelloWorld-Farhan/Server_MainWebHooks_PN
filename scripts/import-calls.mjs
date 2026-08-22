import fs from 'fs';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function importCalls() {
  const filePath = 'C:\\Users\\farhan khalid\\OneDrive\\Pictures\\Documents\\Propnex\\Info\\call_log.xls';
  const fileData = fs.readFileSync(filePath, 'utf-8');
  
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  
  let match;
  let rows = [];
  
  while ((match = trRegex.exec(fileData)) !== null) {
    const trContent = match[1];
    let cellMatch;
    let cells = [];
    while ((cellMatch = tdRegex.exec(trContent)) !== null) {
      cells.push(cellMatch[1].trim());
    }
    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  console.log(`Found ${rows.length} rows to process.`);

  const normalizeNumber = (num) => {
    if (!num || num === "Unknown" || num === "NA") return num;
    let cleaned = num.replace(/\D/g, "");
    if (cleaned.startsWith("9191") && cleaned.length >= 12) {
      cleaned = cleaned.substring(2);
    }
    if (cleaned.startsWith("91") && cleaned.length >= 12) {
      return "+" + cleaned;
    }
    return cleaned;
  };

  for (const row of rows) {
    const [id, vid, caller, Dnid, ForwardedNum, UniqueID, StartDate, Enddate, StartTime, EndTime, Duration, RecFile, Dept, Status, dummy_stat, ans_time, state_name, disconnected_by, agent_name, ivr_dur, call_status, custName, callerid] = row;

    if (!UniqueID || UniqueID === "NA" || UniqueID === "UniqueID") continue;

    const callerNum = normalizeNumber(caller) || caller;
    const agentNum = normalizeNumber(Dnid) || Dnid;
    const durationSeconds = parseInt(Duration, 10) || 0;
    
    let statusEnum = "COMPLETED";
    const statusRaw = (call_status || dummy_stat || "").toUpperCase();
    if (statusRaw.includes("FAIL") || statusRaw.includes("ERROR") || statusRaw.includes("REJECT")) statusEnum = "FAILED";
    else if (statusRaw.includes("BUSY") || statusRaw.includes("NO ANSWER") || statusRaw.includes("NO_ANSWER") || statusRaw.includes("MISSED")) statusEnum = "MISSED";

    let startedAt = new Date(`${StartDate}T${StartTime}+05:30`);
    if (isNaN(startedAt.getTime())) {
      startedAt = new Date();
    }

    let company = null;
    let phoneRec = await prisma.phoneNumber.findFirst({
      where: { 
        OR: [
          { number: { contains: Dnid } },
          { number: { contains: agentNum } },
          { number: { contains: agentNum.replace('+', '') } }
        ]
      },
      orderBy: { createdAt: 'desc' },
      include: { company: true }
    });

    if (phoneRec && phoneRec.company) {
      company = phoneRec.company;
    }
    
    // Explicitly fallback to Developer_Test (PropNex AI Technology)
    if (!company) {
       company = await prisma.company.findFirst({ where: { name: 'Developer_Test' } });
    }
    if (!company) {
       company = await prisma.company.findFirst();
    }

    const creditsUsed = durationSeconds > 0 ? Math.ceil(durationSeconds / 60) * 1.75 : 0;
    const callLogId = UniqueID;
    
    const existing = await prisma.callLog.findFirst({ where: { providerCallId: callLogId } });
    if (!existing) {
       let lead = await prisma.lead.findFirst({ where: { companyId: company.id, phone: callerNum } });
       if (!lead) {
         let stage = await prisma.leadPipelineStage.findFirst({ where: { companyId: company.id } });
         if (!stage) {
            stage = await prisma.leadPipelineStage.create({ data: { name: "New", slug: "new", color: "#3B82F6", order: 0, companyId: company.id } });
         }
         lead = await prisma.lead.create({
            data: { companyId: company.id, phone: callerNum, firstName: "Incoming", lastName: "Caller", stageId: stage.id }
         });
       }

       await prisma.callLog.create({
         data: {
           companyId: company.id,
           phoneNumberId: phoneRec ? phoneRec.id : undefined,
           callLogId: callLogId,
           publicId: `INB-${callLogId}`,
           leadId: lead.id,
           direction: "INBOUND",
           status: statusEnum,
           startedAt: startedAt,
           durationSeconds: durationSeconds,
           creditsUsed: creditsUsed,
           provider: "webhook",
           providerCallId: callLogId,
           recordingUrl: `/api/calls/${callLogId}/recording`
         }
       });
       console.log(`Inserted call ${callLogId} for company ${company.name}`);
    } else {
       console.log(`Call ${callLogId} already exists, skipping.`);
    }
  }

  console.log('Finished inserting calls. Recalculating credits...');
  
  const companies = await prisma.company.findMany();
  for (const c of companies) {
    const totalUsed = await prisma.callLog.aggregate({
      where: { companyId: c.id },
      _sum: { creditsUsed: true }
    });
    const used = totalUsed._sum.creditsUsed || 0;
    const allocated = c.allocatedCredits || 0;
    const remaining = Math.max(0, allocated - used);
    
    await prisma.company.update({
      where: { id: c.id },
      data: { creditsUsed: used, creditBalance: remaining }
    });
  }
  console.log('Credits recalculated successfully.');
}

importCalls().catch(console.error).finally(() => prisma.$disconnect());
