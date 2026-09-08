const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "mongodb://propnex_admin:Propnexai%40123@200.234.34.240:27017/propnex?authSource=admin"
    }
  }
});

async function test() {
  try {
    const companies = await prisma.company.findMany();
    console.log("Companies:", companies.length);
    
    const users = await prisma.user.findMany();
    console.log("Users:", users.length);
  } catch(e) {
    console.error("Prisma error:", e);
  } finally {
    await prisma.$disconnect();
  }
}

test();
