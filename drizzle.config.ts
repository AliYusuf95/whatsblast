import { configs } from '@/server/db/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: configs.schema,
  out: configs.out,
  dialect: configs.dialect,
  dbCredentials: {
    url: configs.dbCredentials.url,
  },
  migrations: {
    table: configs.migrations.table,
    schema: configs.migrations.schema,
  },
  schemaFilter: configs.schemaFilter,
  verbose: configs.verbose,
  strict: configs.strict,
});
