import { MongoClient, GridFSBucket } from "mongodb";

let client: MongoClient | null = null;

export async function getDb() {
  if (!client) {
    const uri = process.env.DATABASE_URL;
    if (!uri) throw new Error("DATABASE_URL is not set");
    client = new MongoClient(uri);
    await client.connect();
  }
  return client.db();
}

export async function getGridFS() {
  const db = await getDb();
  // Most GridFS implementations use "fs" as bucket name by default
  return new GridFSBucket(db, { bucketName: "fs" });
}
