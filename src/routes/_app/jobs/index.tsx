import { createFileRoute } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useQuery, useMutation } from '@tanstack/react-query';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  RefreshCw,
  Eye,
  Square,
  Trash2,
  Clock,
  CheckCircle,
  XCircle,
  Play,
  Plus,
  Filter,
  Search,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Route as jobIdRoute } from '@/routes/_app/jobs/$jobId';
import { Route as messaging } from '@/routes/_app/messaging';

// Initialize dayjs plugin
dayjs.extend(relativeTime);

export const Route = createFileRoute('/_app/jobs/')({
  component: JobsPage,
  context({ context }) {
    return {
      ...context,
      getTitle: () => undefined,
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

function JobsPage() {
  const navigate = useNavigate();
  const [selectedSessionId, setSelectedSessionId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Helper function to check if we need real-time updates
  const needsRealTimeUpdates = (jobs: BulkJob[]) => {
    return jobs.some((job) => job.status === 'pending' || job.status === 'processing');
  };

  // Fetch sessions for filter
  const { data: sessionsResponse, isLoading: sessionsLoading } = useQuery(
    trpc.sessions.getSessions.queryOptions(),
  );

  const sessions = sessionsResponse?.data || [];

  // Fetch messages jobs
  const {
    data: jobsResponse,
    isLoading: jobsLoading,
    refetch: refetchJobs,
  } = useQuery(
    trpc.bulk.getBulkJobs.queryOptions(
      {
        sessionId: selectedSessionId === 'all' ? undefined : selectedSessionId,
        limit: 50,
        offset: 0,
      },
      {
        refetchInterval: ({ state: { data } }) => {
          // Only poll if there are active jobs (pending or processing)
          const jobs = data?.data || [];
          return needsRealTimeUpdates(jobs) ? 5000 : false;
        },
      },
    ),
  );

  const jobs = jobsResponse?.data || [];

  // Also track when to show live update indicator
  const hasActiveJobs = needsRealTimeUpdates(jobs);

  // Stop job mutation
  const stopJobMutation = useMutation(
    trpc.bulk.stopBulkJob.mutationOptions({
      onSuccess: () => {
        toast.success('Job stopped successfully');
        refetchJobs();
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
        refetchJobs();
      },
      onError: (error) => {
        toast.error(`Failed to delete job: ${error.message}`);
      },
    }),
  );

  // Filter jobs based on search and status
  const filteredJobs = jobs.filter((job) => {
    const matchesSearch = job.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || job.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

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

  // Calculate progress percentage
  function getProgress(job: BulkJob): number {
    if (job.totalMessages === 0) return 0;
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
  const handleStopJob = (jobId: string) => {
    stopJobMutation.mutate({ jobId });
  };

  // Handle delete job
  const handleDeleteJob = (jobId: string) => {
    deleteJobMutation.mutate({ jobId });
  };

  if (jobsLoading || sessionsLoading) {
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

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Messages Jobs</h1>
          <p className="text-muted-foreground">Monitor and manage your messages jobs</p>
        </div>
        <div className="flex gap-2 items-center">
          {hasActiveJobs && (
            <div className="flex items-center text-sm text-muted-foreground bg-blue-50 px-3 py-2 rounded-md">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse mr-2"></div>
              Auto-updating every 5s
            </div>
          )}
          <Button variant="outline" onClick={() => refetchJobs()} disabled={jobsLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${jobsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => navigate({ to: messaging.to })}>
            <Plus className="h-4 w-4 mr-2" />
            New Job
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Search Jobs</label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by job name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Session</label>
              <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
                <SelectTrigger>
                  <SelectValue placeholder="All sessions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sessions</SelectItem>
                  {sessions.map((session) => (
                    <SelectItem key={session.id} value={session.id}>
                      {session.description}
                      {session.phone && (
                        <span className="text-muted-foreground ml-2">({session.phone})</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Jobs List */}
      {filteredJobs.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Jobs Found</h3>
            <p className="text-muted-foreground mb-4">
              {jobs.length === 0
                ? "You haven't created any bulk messaging jobs yet."
                : 'No jobs match your current filters.'}
            </p>
            <Button onClick={() => navigate({ to: messaging.to })}>
              <Plus className="h-4 w-4 mr-2" />
              Create First Job
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredJobs.map((job) => (
            <Card key={job.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-3">
                      {job.name}
                      {getStatusBadge(job.status)}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-4">
                      <span>Created {dayjs(job.createdAt).fromNow()}</span>
                      {job.startedAt && <span>• Started {dayjs(job.startedAt).fromNow()}</span>}
                      {job.completedAt && (
                        <span>• Completed {dayjs(job.completedAt).fromNow()}</span>
                      )}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate({ to: jobIdRoute.to, params: { jobId: job.id } })}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View
                    </Button>
                    {canStopJob(job.status) && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" disabled={stopJobMutation.isPending}>
                            <Square className="h-4 w-4 mr-1" />
                            Stop
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Stop Job</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to stop "{job.name}"? This action cannot be
                              undone and will cancel any pending messages.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleStopJob(job.id)}>
                              Stop Job
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    {canDeleteJob(job.status) && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={deleteJobMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Job</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete "{job.name}"? This action cannot be
                              undone and will remove all job data and message history.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeleteJob(job.id)}>
                              Delete Job
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Progress */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Progress</span>
                      <span>
                        {job.processedMessages} of {job.totalMessages} processed ({getProgress(job)}
                        %)
                      </span>
                    </div>
                    <Progress value={getProgress(job)} className="h-2" />
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div className="text-center p-2 bg-secondary rounded">
                      <div className="font-semibold text-lg">{job.totalMessages}</div>
                      <div className="text-muted-foreground">Total</div>
                    </div>
                    <div className="text-center p-2 bg-green-100 text-green-800 rounded">
                      <div className="font-semibold text-lg">{job.successfulMessages}</div>
                      <div className="text-green-600">Sent</div>
                    </div>
                    <div className="text-center p-2 bg-red-100 text-red-800 rounded">
                      <div className="font-semibold text-lg">{job.failedMessages}</div>
                      <div className="text-red-600">Failed</div>
                    </div>
                    <div className="text-center p-2 bg-gray-100 text-gray-800 rounded">
                      <div className="font-semibold text-lg">
                        {job.totalMessages - job.processedMessages}
                      </div>
                      <div className="text-gray-600">Pending</div>
                    </div>
                  </div>

                  {/* Error Message */}
                  {job.errorMessage && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
                      <strong>Error:</strong> {job.errorMessage}
                    </div>
                  )}

                  {/* Session Info */}
                  <div className="text-sm text-muted-foreground">
                    Session:{' '}
                    {sessions.find((s) => s.id === job.sessionId)?.description || 'Unknown'}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
