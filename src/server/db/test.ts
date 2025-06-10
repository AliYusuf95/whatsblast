import { db } from "./config";
import { whatsappSessions } from "./schema";

async function testDatabase() {
  try {
    console.log("Testing database connection...");
    
    // Test basic connection by querying sessions
    const sessions = await db.select().from(whatsappSessions).limit(1);
    console.log("✅ Database connection successful!");
    console.log("Current sessions:", sessions.length);
    
    console.log("✅ Database schema test completed successfully!");
  } catch (error) {
    console.error("❌ Database test failed:", error);
    process.exit(1);
  }
}

await testDatabase();
