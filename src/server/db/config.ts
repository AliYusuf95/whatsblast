import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';
import { runMigrationsOnDb } from './utils';

export const configs = {
  schema: './src/server/db/schema.ts',
  out: './src/server/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/whatsblast.db',
  },
  migrations: {
    table: '__drizzle_migrations',
    schema: 'public',
  },
  schemaFilter: ['public'] as string[],
  verbose: true,
  strict: true,
} as const;

function isValidConfig(config: any): config is { dbCredentials: { url: string }; out: string } {
  return (
    'dbCredentials' in config &&
    'url' in config.dbCredentials &&
    typeof config.dbCredentials.url === 'string' &&
    'out' in config &&
    typeof config.out === 'string'
  );
}

if (!isValidConfig(configs)) {
  throw new Error('Database configuration is missing in drizzle.config.ts');
}

const sqlite = new Database(configs.dbCredentials.url);
sqlite.exec('PRAGMA journal_mode = WAL;');
const database = drizzle({ client: sqlite, schema });

const runMigrations = async () => {
  // backup database if it exists
  if (await Bun.file(sqlite.filename).exists()) {
    console.log('Backing up existing database');
    const backupPath = sqlite.filename + '.backup';
    if (await Bun.file(backupPath).exists()) {
      await Bun.file(backupPath).delete();
    }
    await Bun.write(backupPath, sqlite.filename);
    Bun.redis;
  } else {
    console.warn('Database file does not exist, skipping backup.');
    // If the database file doesn't exist, we can skip the backup
    return;
  }
  console.log('Running database migrations...');
  console.time('Database migrations');
  await runMigrationsOnDb(database);
  console.timeEnd('Database migrations');
};

export { database as db, runMigrations, schema };
