import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { configs } from './config';

/**
 * Run migrations on an existing database instance (for tests)
 */
export async function runMigrationsOnDb(db: ReturnType<typeof drizzle>) {
  await migrate(db, { migrationsFolder: configs.out!! });
}
