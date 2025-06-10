import { createFileRoute } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useNavigate } from '@tanstack/react-router';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  RefreshCw,
  ArrowLeft,
  Square,
  Trash2,
  Clock,
  CheckCircle,
  XCircle,
  Play,
  Download,
  AlertCircle,
  MessageSquare,
  Users,
  Calendar,
  Activity,
  Phone,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Route as jobsRoute } from '@/routes/_app/jobs/index';

// Initialize dayjs plugin
dayjs.extend(relativeTime);

export const Route = createFileRoute('/_app/jobs/$jobId')({
  component: JobDetailPage,
  context({ context }) {
    return {
      ...context,
      getTitle: () => 'Job Details',
    };
  },
});

interface BulkJob {
  id: string;
  userId: string;
  sessionId: string;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  totalMessages: number;
  processedMessages: number;
  successfulMessages: number;
  failedMessages: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface BulkMessage {
  id: string;
  jobId: string;
  phoneNumber: string;
  message: string;
  status: 'pending' | 'sent' | 'failed';
  sentAt: string | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

interface JobProgress {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  progress: number;
}

function JobDetailPage() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();
  const messagesLimit = 50;
  const queryClient = useQueryClient();
  const [isExporting, setIsExporting] = useState(false);

  // Helper function to check if job is in final state
  const isJobInFinalState = (status: BulkJob['status']) => {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
  };

  // Fetch job details
  const {
    data: jobResponse,
    isLoading: jobLoading,
    refetch: refetchJob,
  } = useQuery(
    trpc.bulk.getBulkJob.queryOptions(
      { jobId },
      {
        refetchInterval: ({ state: { data } }) => {
          // Stop refetching if job is in final state
          const job = data?.data;
          return job && isJobInFinalState(job.status) ? false : 3000;
        },
      },
    ),
  );

  const job: BulkJob | null = jobResponse?.data || null;

  // Fetch job progress - only refetch if job is not in final state
  const { data: progressResponse, isLoading: progressLoading } = useQuery(
    trpc.bulk.getBulkProgress.queryOptions(
      { jobId },
      {
        refetchInterval: job && !isJobInFinalState(job.status) ? 3000 : false,
        enabled: !!job,
      },
    ),
  );

  const progress: JobProgress | null = progressResponse?.data?.progress || null;

  // Fetch job messages using infinite query
  const {
    data: messagesData,
    isLoading: messagesLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch: refetchMessages,
  } = useInfiniteQuery(
    trpc.bulk.getBulkMessagesInfinite.infiniteQueryOptions(
      { jobId, limit: messagesLimit },
      {
        enabled: !!job,
        refetchInterval: job && !isJobInFinalState(job.status) ? 3000 : false,
        placeholderData: (previousData) => previousData,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    ),
  );

  const messages: BulkMessage[] = messagesData?.pages.flatMap((page) => page.data || []) || [];

  // Export query - disabled by default, only enabled when export is triggered
  const {
    data: exportData,
    isLoading: isExportLoading,
    refetch: triggerExport,
  } = useQuery(
    trpc.bulk.getBulkMessages.queryOptions(
      {
        jobId,
        limit: job?.totalMessages || 0,
        offset: 0,
      },
      {
        enabled: false, // Disabled by default
        gcTime: 0, // Don't cache export data
        staleTime: 0, // Always fresh
        refetchInterval: false,
      },
    ),
  );

  // Fetch session info
  const { data: sessionResponse } = useQuery(
    trpc.sessions.getSession.queryOptions(
      { sessionId: job?.sessionId || '' },
      {
        enabled: !!job?.sessionId,
      },
    ),
  );

  const session = sessionResponse?.data || null;

  // Stop job mutation
  const stopJobMutation = useMutation(
    trpc.bulk.stopBulkJob.mutationOptions({
      onSuccess: () => {
        toast.success('Job stopped successfully');
        refetchJob();
      },
      onError: (error) => {
        toast.error(`Failed to stop job: ${error.message}`);
      },
    }),
  );

  // Delete job mutation
  const deleteJobMutation = useMutation(
    trpc.bulk.deleteBulkJob.mutationOptions({
      onSuccess: () => {
        toast.success('Job deleted successfully');
        navigate({ to: jobsRoute.to });
      },
      onError: (error) => {
        toast.error(`Failed to delete job: ${error.message}`);
      },
    }),
  );

  // Get status badge
  function getStatusBadge(status: BulkJob['status']) {
    switch (status) {
      case 'pending':
        return (
          <Badge variant="secondary">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case 'processing':
        return (
          <Badge variant="outline">
            <Play className="h-3 w-3 mr-1" />
            Processing
          </Badge>
        );
      case 'completed':
        return (
          <Badge variant="default" className="bg-green-600">
            <CheckCircle className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      case 'cancelled':
        return (
          <Badge variant="secondary">
            <Square className="h-3 w-3 mr-1" />
            Cancelled
          </Badge>
        );
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  }

  // Get message status badge
  function getMessageStatusBadge(status: BulkMessage['status']) {
    switch (status) {
      case 'pending':
        return (
          <Badge variant="secondary" className="text-xs">
            Pending
          </Badge>
        );
      case 'sent':
        return (
          <Badge variant="default" className="bg-green-600 text-xs">
            Sent
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive" className="text-xs">
            Failed
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="text-xs">
            Unknown
          </Badge>
        );
    }
  }

  // Calculate progress percentage
  function getProgress(): number {
    if (!job || job.totalMessages === 0) return 0;
    return Math.round((job.processedMessages / job.totalMessages) * 100);
  }

  // Check if job can be stopped
  function canStopJob(status: BulkJob['status']): boolean {
    return status === 'pending' || status === 'processing';
  }

  // Check if job can be deleted
  function canDeleteJob(status: BulkJob['status']): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
  }

  // Handle stop job
  const handleStopJob = () => {
    if (job) {
      stopJobMutation.mutate({ jobId: job.id });
    }
  };

  // Handle delete job
  const handleDeleteJob = () => {
    if (job) {
      deleteJobMutation.mutate({ jobId: job.id });
    }
  };

  // Export ALL messages to CSV with optimized disabled query
  const handleExportMessages = async () => {
    if (!job || isExportLoading) return;

    setIsExporting(true);
    toast.info('Fetching all messages for export...');

    try {
      // Trigger the disabled export query
      const result = await triggerExport();
      const allMessages = result.data?.data || [];

      if (!allMessages.length) {
        toast.error('No messages found to export');
        return;
      }

      const csvContent = [
        ['Phone Number', 'Message', 'Status', 'Sent At', 'Error', 'Retry Count'].join(','),
        ...allMessages.map((msg) =>
          [
            msg.phoneNumber,
            `"${msg.message.replace(/"/g, '""')}"`, // Escape quotes in message
            msg.status,
            msg.sentAt ? dayjs(msg.sentAt).format('YYYY-MM-DD HH:mm:ss') : '',
            msg.errorMessage ? `"${msg.errorMessage.replace(/"/g, '""')}"` : '',
            msg.retryCount.toString(),
          ].join(','),
        ),
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `job-${job?.name?.replace(/[^a-zA-Z0-9]/g, '-') || jobId}-messages.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${allMessages.length} messages to CSV`);
    } catch (error) {
      console.error('Failed to export messages:', error);
      toast.error('Failed to export messages. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  if (jobLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <Card>
            <CardContent className="pt-6 space-y-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="container mx-auto p-6">
        <Card className="text-center py-12">
          <CardContent>
            <AlertCircle className="h-12 w-12 mx-auto text-red-500 mb-4" />
            <h3 className="text-lg font-semibold mb-2">Job Not Found</h3>
            <p className="text-muted-foreground mb-4">
              The job you're looking for doesn't exist or you don't have access to it.
            </p>
            <Button onClick={() => navigate({ to: jobsRoute.to })}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Jobs
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: jobsRoute.to })}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Jobs
            </Button>
          </div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            {job.name}
            {getStatusBadge(job.status)}
          </h1>
          <p className="text-muted-foreground">
            Created {dayjs(job.createdAt).fromNow()}
            {job.startedAt && ` • Started ${dayjs(job.startedAt).fromNow()}`}
            {job.completedAt && ` • Completed ${dayjs(job.completedAt).fromNow()}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetchJob()} disabled={jobLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${jobLoading ? 'animate-spin' : ''}`} />
            {job && isJobInFinalState(job.status) ? 'Refresh' : 'Refresh'}
          </Button>
          {job && !isJobInFinalState(job.status) && (
            <div className="flex items-center text-sm text-muted-foreground bg-blue-50 px-3 py-2 rounded-md">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse mr-2"></div>
              Auto-updating every 3s
            </div>
          )}
          {canStopJob(job.status) && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={stopJobMutation.isPending}>
                  <Square className="h-4 w-4 mr-2" />
                  Stop Job
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Stop Job</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to stop "{job.name}"? This action cannot be undone and
                    will cancel any pending messages.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleStopJob}>Stop Job</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {canDeleteJob(job.status) && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={deleteJobMutation.isPending}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Job
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Job</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete "{job.name}"? This action cannot be undone and
                    will remove all job data and message history.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteJob}>Delete Job</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Job Progress */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Progress Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Overall Progress</span>
                <span>
                  {job.processedMessages} of {job.totalMessages} processed ({getProgress()}%)
                </span>
              </div>
              <Progress value={getProgress()} className="h-3" />
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-4 bg-secondary rounded-lg">
                <div className="font-bold text-2xl">{job.totalMessages}</div>
                <div className="text-muted-foreground text-sm">Total Messages</div>
              </div>
              <div className="text-center p-4 bg-green-100 text-green-800 rounded-lg">
                <div className="font-bold text-2xl">{job.successfulMessages}</div>
                <div className="text-green-600 text-sm">Successfully Sent</div>
              </div>
              <div className="text-center p-4 bg-red-100 text-red-800 rounded-lg">
                <div className="font-bold text-2xl">{job.failedMessages}</div>
                <div className="text-red-600 text-sm">Failed</div>
              </div>
              <div className="text-center p-4 bg-gray-100 text-gray-800 rounded-lg">
                <div className="font-bold text-2xl">
                  {job.totalMessages - job.processedMessages}
                </div>
                <div className="text-gray-600 text-sm">Pending</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Job Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Job Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Job Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Job Name</label>
                <p className="mt-1">{job.name}</p>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground">Status</label>
                <div className="mt-1">{getStatusBadge(job.status)}</div>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground">Created</label>
                <p className="mt-1">
                  {job.createdAt
                    ? dayjs(job.createdAt).format('MMMM D, YYYY [at] h:mm A')
                    : 'Unknown'}
                </p>
              </div>

              {job.startedAt && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Started</label>
                  <p className="mt-1">{dayjs(job.startedAt).format('MMMM D, YYYY [at] h:mm A')}</p>
                </div>
              )}

              {job.completedAt && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Completed</label>
                  <p className="mt-1">
                    {dayjs(job.completedAt).format('MMMM D, YYYY [at] h:mm A')}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Session Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              Session Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {session ? (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Session</label>
                  <p className="mt-1">{session.description}</p>
                </div>

                {session.phone && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      Phone Number
                    </label>
                    <p className="mt-1 font-mono">{session.phone}</p>
                  </div>
                )}

                {session.name && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      Account Name
                    </label>
                    <p className="mt-1">{session.name}</p>
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Session Status
                  </label>
                  <div className="mt-1">
                    <Badge variant={session.status === 'paired' ? 'default' : 'secondary'}>
                      {session.status === 'paired' ? 'Connected' : 'Not Connected'}
                    </Badge>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                <p>Session information not available</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Error Message */}
      {job.errorMessage && (
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-800">
              <XCircle className="h-5 w-5" />
              Error Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800">
              {job.errorMessage}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Messages List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Messages ({messages.length})
              </CardTitle>
              {job && !isJobInFinalState(job.status) && (
                <div className="flex items-center text-xs text-muted-foreground">
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse mr-1"></div>
                  Live updates
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportMessages}
              disabled={messages.length === 0 || isExporting || isExportLoading}
            >
              {isExporting || isExportLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </>
              )}
            </Button>
          </div>
          <CardDescription>Individual message delivery status</CardDescription>
        </CardHeader>
        <CardContent>
          {messagesLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2" />
              <p>No messages found for this job</p>
            </div>
          ) : (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Phone Number</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent At</TableHead>
                    <TableHead>Retries</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.map((message) => (
                    <TableRow key={message.id}>
                      <TableCell className="font-mono">{message.phoneNumber}</TableCell>
                      <TableCell>{getMessageStatusBadge(message.status)}</TableCell>
                      <TableCell>
                        {message.sentAt ? dayjs(message.sentAt).format('MMM D, h:mm A') : '-'}
                      </TableCell>
                      <TableCell>{message.retryCount}</TableCell>
                      <TableCell className="max-w-xs truncate" title={message.errorMessage || ''}>
                        {message.errorMessage || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Load More Button for Infinite Query */}
              {hasNextPage && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      'Load More Messages'
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
