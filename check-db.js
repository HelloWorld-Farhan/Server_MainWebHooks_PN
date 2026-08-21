
require('dotenv').config();
const { MongoClient } = require('mongodb');
async function run() {
  const uri = process.env.DATABASE_URL;
  if (!uri) { console.log('No DATABASE_URL'); return; }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  
  const callLogsCount = await db.collection('CallLog').countDocuments();
  const gridFsCount = await db.collection('fs.files').countDocuments();
  const transcriptsCount = await db.collection('transcripts').countDocuments();
  
  console.log('CallLogs in database:', callLogsCount);
  console.log('Recordings in GridFS (fs.files):', gridFsCount);
  console.log('Transcripts in transcripts:', transcriptsCount);
  
  // Try to find the most recent CallLog
  const recentCall = await db.collection('CallLog').find({ direction: 'INBOUND' }).sort({ startedAt: -1 }).limit(1).toArray();
  if (recentCall.length > 0) {
    const logId = recentCall[0].providerCallId || recentCall[0].callLogId;
    console.log('Most recent Inbound Call Log ID:', logId);
    
    // Check if recording exists for this logId
    const rec = await db.collection('fs.files').findOne({ $or: [{ 'call_id': logId }, { 'metadata.call_id': logId }] });
    console.log('Recording exists for most recent call?', !!rec);
  }
  
  await client.close();
}
run().catch(console.error);

