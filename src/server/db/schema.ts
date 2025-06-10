import { sqliteTable, text, integer, blob, unique } from 'drizzle-orm/sqlite-core';
import { createId } from '@paralleldrive/cuid2';
import { user } from './auth-schema';

export * from './auth-schema'; // Export Better-Auth schema for use in other parts of the app

// WhatsApp Session Status Enum
export type SessionStatus = 'not_auth' | 'qr_pairing' | 'paired';

// WhatsApp Sessions Schema
export const whatsappSessions = sqliteTable('whatsapp_sessions', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }), // Now properly references Better-Auth user table
  description: text('description').notNull(),
  status: text('status').$type<SessionStatus>().notNull().default('not_auth'),
  phone: text('phone'),
  name: text('name'),
  qrCode: text('qr_code'), // Base64 QR code for pairing
  qrExpiresAt: integer('qr_expires_at', { mode: 'timestamp' }),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Baileys Auth State Storage
export const authStates = sqliteTable(
  'auth_states',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    sessionId: text('session_id')
      .notNull()
      .references(() => whatsappSessions.id, { onDelete: 'cascade' }),
    key: text('key').notNull(), // Auth state key (e.g., 'creds', 'app-state-sync-key-*')
    value: blob('value').notNull(), // Serialized auth state data
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  (table) => [
    // Unique constraint on sessionId + key combination for upsert operations
    unique('sessionKeyUnique').on(table.sessionId, table.key),
  ],
);

// Bulk Job Status Enum
export type BulkJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

// Messages Jobs Schema
export const bulkJobs = sqliteTable('bulk_jobs', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  userId: text('user_id').notNull(), // Will reference Better-Auth user table
  sessionId: text('session_id')
    .notNull()
    .references(() => whatsappSessions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status').$type<BulkJobStatus>().notNull().default('pending'),
  totalMessages: integer('total_messages').notNull().default(0),
  processedMessages: integer('processed_messages').notNull().default(0),
  successfulMessages: integer('successful_messages').notNull().default(0),
  failedMessages: integer('failed_messages').notNull().default(0),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Bulk Messages Schema (individual messages within a job)
export const bulkMessages = sqliteTable('bulk_messages', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  jobId: text('job_id')
    .notNull()
    .references(() => bulkJobs.id, { onDelete: 'cascade' }),
  phoneNumber: text('phone_number').notNull(),
  message: text('message').notNull(),
  status: text('status').$type<'pending' | 'sent' | 'failed'>().notNull().default('pending'),
  sentAt: integer('sent_at', { mode: 'timestamp' }),
  errorMessage: text('error_message'),
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
