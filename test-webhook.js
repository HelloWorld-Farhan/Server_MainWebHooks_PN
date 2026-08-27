const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  const body = {
    event: "call.ringing",
    logId: "8cff43ee-9258-4d79-a8d8-1876ef460a29",
    call: {
      id: "8cff43ee-9258-4d79-a8d8-1876ef460a29",
      from: "00917969007102",
      to: "8851860838",
      customParameters: {
        companyId: "6a897a7c500636731c1f15da",
        callType: "outbound"
      }
    }
  };
  
  const callObj = body.call || {};
  const agentNumber = callObj.to || body.agentNumber || body.agent_number || "";
  const callingNo = callObj.from || body.callingNo || body.calling_number || body.customer_number || "";
  
  const getNumberVariants = (num) => {
    if (!num) return [];
    let n = num.replace(/\D/g, '');
    let variants = [];
    if (n.startsWith('91') && n.length > 10) n = n.substring(2);
    if (n.startsWith('0') && n.length > 10) n = n.substring(1);
    
    variants.push(n); // local
    variants.push(`91${n}`);
    variants.push(`+91${n}`);
    variants.push(`0${n}`);
    variants.push(`0091${n}`);
    return variants;
  };
  
  const agentVariants = getNumberVariants(agentNumber);
  const callingVariants = getNumberVariants(callingNo);
  const normalizedCallingNo = callingVariants.find(v => v.startsWith("+")) || callingVariants[0];
  const normalizedAgentNumber = agentVariants.find(v => v.startsWith("+")) || agentVariants[0];
  
  let companies = [];
  let resolvedPhoneNumber = null;
  
  const customParamsStr = body.custom_parameters || callObj.customParameters || callObj.custom_parameters;
  let customParams = {};
  try {
    if (typeof customParamsStr === 'string') customParams = JSON.parse(customParamsStr);
    else if (typeof customParamsStr === 'object') customParams = customParamsStr;
  } catch(e) {}
  
  let direction = "INBOUND";
  const payloadCompanyId = customParams?.companyId || customParams?.company_id;
  if (payloadCompanyId) {
    const exactCompany = await prisma.company.findUnique({ where: { id: payloadCompanyId } });
    if (exactCompany) {
      companies = [exactCompany];
      direction = customParams.callType === "outbound" ? "OUTBOUND" : "INBOUND";
    }
  }
  
  console.log("Resolved Company:", companies.map(c => c.name));
  console.log("Direction:", direction);
  console.log("Customer number:", direction === "OUTBOUND" ? normalizedAgentNumber : normalizedCallingNo);
}

test().catch(console.error).finally(() => prisma.$disconnect());
