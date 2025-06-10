// Queue and Worker Setup Test
// Verifies BullMQ configuration and Redis connection

import { queueManager } from '../queue/queues';
import { workerManager } from '../workers/base-worker';

async function testQueueSetup() {
  try {
    console.log('🧪 Testing Queue and Worker Setup...\n');

    // Test queue manager initialization
    console.log('1. Initializing queue manager...');
    await queueManager.initialize();

    // Test queue stats
    console.log('2. Getting queue statistics...');
    const stats = await queueManager.getQueueStats();
    console.log('Queue stats:', stats);

    // Test worker manager
    console.log('3. Testing worker manager...');
    console.log('Worker count:', workerManager.getWorkerCount());
    console.log('Workers status:', workerManager.getWorkersStatus());

    console.log('\n✅ Queue and Worker setup test completed successfully!');
    queueManager.resumeAll();
    queueManager.shutdown();
  } catch (error) {
    console.error('\n❌ Queue setup test failed:', error);
    process.exit(1);
  }
}

// Run the test if this file is executed directly
if (import.meta.main) {
  await testQueueSetup();
}
