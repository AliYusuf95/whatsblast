// TypeScript definitions for all BullMQ job types

import type { Job } from 'bullmq';

// Base job data interface
export interface BaseJobData {
  id?: string;
  sessionId: string;
  userId?: string;
  timestamp?: number;
  priority?: number;
}

// Base interface for maintenance jobs (sessionId is optional)
export interface BaseMaintenanceJobData {
  id?: string;
  sessionId?: string;
  userId?: string;
  timestamp?: number;
  priority?: number;
  type: string;
}

// Authentication job types
export interface QRGenerationJobData extends BaseJobData {
  type: 'qr_generation';
}

export interface PairingJobData extends BaseJobData {
  type: 'pairing_verification';
  pairingCode?: string;
  phoneNumber?: string;
}

export interface AuthValidationJobData extends BaseJobData {
  type: 'auth_validation';
  userId: string;
}

export interface LogoutJobData extends BaseJobData {
  type: 'logout';
  reason?: string;
}

export type AuthJobData =
  | QRGenerationJobData
  | PairingJobData
  | AuthValidationJobData
  | LogoutJobData;

// Message job types
export interface SingleMessageJobData extends BaseJobData {
  type: 'single_message';
  recipient: string;
  message: string;
  messageType?: 'text' | 'image' | 'document' | 'audio';
  mediaUrl?: string;
  mediaCaption?: string;
}

export interface BulkMessageJobData extends BaseJobData {
  type: 'bulk_message';
  bulkJobId: string;
  recipients: Array<{
    messageId: string; // Unique message ID for database tracking
    phone: string;
    data: string[];
  }>;
  template: Array<string | number>; // Template for the message
  batchSize?: number;
  delay?: number; // Delay between messages in ms
}

export interface MessageStatusJobData extends BaseJobData {
  type: 'message_status';
  messageId: string;
  action: 'check' | 'update';
}

export type MessageJobData = SingleMessageJobData | BulkMessageJobData | MessageStatusJobData;

// Maintenance job types
export interface ConnectionCheckJobData extends BaseMaintenanceJobData {
  type: 'connection_health_check';
  sessionId?: string; // Optional - if not provided, checks all inactive sessions
  inactiveHoursThreshold?: number; // Default 24 hours
  checkAllSessions?: boolean; // If true, checks all paired sessions regardless of activity
}

export type MaintenanceJobData = ConnectionCheckJobData;

// Bulk operation job types
export interface BulkOperationJobData extends BaseJobData {
  type: 'bulk_operation';
  operation: 'message' | 'contact_check' | 'group_message';
  bulkJobId: string;
  totalItems: number;
  processedItems?: number;
  failedItems?: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
}

// Union type for all job data
export type AllJobData = AuthJobData | MessageJobData | MaintenanceJobData | BulkOperationJobData;

// Job result types
export interface JobResult {
  success: boolean;
  data?: any;
  error?: string;
  timestamp: number;
  duration?: number;
}

export interface AuthJobResult extends JobResult {
  qrCode?: string;
  authState?: 'authenticated' | 'unauthenticated' | 'pairing';
  phoneNumber?: string;
}

export interface MessageJobResult extends JobResult {
  messageId?: string;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
  recipient?: string;
  sentCount?: number;
  failedCount?: number;
}

export interface MaintenanceJobResult extends JobResult {
  healthStatus?: 'healthy' | 'unhealthy';
  cleanedItems?: number;
  validationResult?: 'valid' | 'invalid' | 'reconnected';
  connectionStatus?: 'connected' | 'disconnected' | 'connecting';
}

export interface BulkJobResult extends JobResult {
  processed: number;
  failed: number;
  total: number;
  completedAt?: number;
  errors?: Array<{
    item: any;
    error: string;
  }>;
}

// Typed job interfaces
export type TypedJob<T extends AllJobData> = Job<T, JobResult>;
export type AuthJob = TypedJob<AuthJobData>;
export type MessageJob = TypedJob<MessageJobData>;
export type MaintenanceJob = TypedJob<MaintenanceJobData>;
export type BulkJob = TypedJob<BulkOperationJobData>;

// Job priorities
export const JOB_PRIORITIES = {
  CRITICAL: 1, // Authentication, connection issues
  HIGH: 2, // Real-time messages
  NORMAL: 3, // Bulk messages
  LOW: 4, // Maintenance, cleanup
} as const;

// Job delay constants (in milliseconds)
export const JOB_DELAYS = {
  IMMEDIATE: 0,
  SHORT: 1000, // 1 second
  MEDIUM: 5000, // 5 seconds
  LONG: 30000, // 30 seconds
  VERY_LONG: 300000, // 5 minutes
} as const;
