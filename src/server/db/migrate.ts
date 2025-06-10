import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';
import { runMigrationsOnDb } from './utils';

export async function runMigrations() {
  const sqlite = new Database('data/whatsblast.db');
  const db = drizzle({ client: sqlite, schema });

  console.log('Running migrations...');
  await runMigrationsOnDb(db);
  console.log('Migrations complete!');
}

// runMigrations().catch((error) => {
//   console.error('Migration failed:', error);
//   process.exit(1);
// });
