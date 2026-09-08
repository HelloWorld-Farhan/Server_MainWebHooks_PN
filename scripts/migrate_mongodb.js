const { MongoClient } = require('mongodb');

// The old cloud database URL
const SOURCE_URI = "mongodb://propnexaiofficial_db_user:KccmbOVh4GsZp1Ok@ac-bwr5uzv-shard-00-00.vuuzm1i.mongodb.net:27017,ac-bwr5uzv-shard-00-01.vuuzm1i.mongodb.net:27017,ac-bwr5uzv-shard-00-02.vuuzm1i.mongodb.net:27017/propnex?ssl=true&authSource=admin&replicaSet=atlas-j95wo5-shard-0&retryWrites=true&w=majority&appName=Cluster0";

const TARGET_URI = "mongodb://propnex_admin:Propnexai%40123@127.0.0.1:27017/propnex?authSource=admin";

async function migrateDatabase() {
    console.log("🚀 Starting MongoDB Migration from Cloud to Hostinger...");
    
    let sourceClient, targetClient;
    try {
        console.log("Connecting to Source (Cloud Database)...");
        sourceClient = new MongoClient(SOURCE_URI);
        await sourceClient.connect();
        const sourceDb = sourceClient.db("propnex");
        
        console.log("Connecting to Target (Hostinger Database)...");
        targetClient = new MongoClient(TARGET_URI);
        await targetClient.connect();
        const targetDb = targetClient.db("propnex");
        
        // Get all collections
        const collections = await sourceDb.listCollections().toArray();
        console.log(`Found ${collections.length} collections to migrate.`);
        
        for (const colInfo of collections) {
            const collectionName = colInfo.name;
            console.log(`\n📦 Migrating collection: ${collectionName}...`);
            
            const sourceCol = sourceDb.collection(collectionName);
            const targetCol = targetDb.collection(collectionName);
            
            // Clear existing data in target just in case
            await targetCol.deleteMany({});
            
            // Fetch all documents
            const docs = await sourceCol.find({}).toArray();
            
            if (docs.length > 0) {
                await targetCol.insertMany(docs);
                console.log(`✅ Successfully copied ${docs.length} documents.`);
            } else {
                console.log(`⏭️ Collection empty, skipping.`);
            }
        }
        
        console.log("\n🎉 MIGRATION COMPLETE! ALL DATA SUCCESSFULLY COPIED TO HOSTINGER!");
        
    } catch (error) {
        console.error("❌ Migration failed:", error);
    } finally {
        if (sourceClient) await sourceClient.close();
        if (targetClient) await targetClient.close();
    }
}

migrateDatabase();
