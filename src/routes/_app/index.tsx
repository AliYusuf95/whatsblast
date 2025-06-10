import { createFileRoute } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Smartphone,
  MessageSquare,
  Clock,
  CheckCircle,
  XCircle,
  Activity,
  TrendingUp,
  Send,
  RefreshCw,
  Plus,
  BarChart3,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Separator } from '@/components/ui/separator';
import { Route as sessionIdRoute } from '@/routes/_app/sessions/$sessionId';

dayjs.extend(relativeTime);

export const Route = createFileRoute('/_app/')({
  component: DashboardPage,
  context({ context }) {
    return {
      ...context,
      getTitle: () => 'Dashboard',
    };
  },
});

interface DashboardStats {
  sessions: {
    total: number;
    connected: number;
    connecting: number;
    disconnected: number;
  };
  jobs: {
    total: number;
    running: number;
    completed: number;
    failed: number;
    pending: number;
  };
  messages: {
    total: number;
    sent: number;
    failed: number;
    pending: number;
  };
}

function DashboardPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch sessions
  const {
    data: sessions,
    isLoading: sessionsLoading,
    refetch: refetchSessions,
  } = useQuery(
    trpc.sessions.getSessions.queryOptions(undefined, {
      refetchInterval: autoRefresh ? 5000 : false,
    }),
  );

  // Fetch recent jobs
  const {
    data: recentJobs,
    isLoading: jobsLoading,
    refetch: refetchJobs,
  } = useQuery(
    trpc.bulk.getBulkJobs.queryOptions(
      { limit: 5 },
      {
        refetchInterval: autoRefresh ? 3000 : false,
      },
    ),
  );

  // Calculate dashboard stats
  const stats: DashboardStats | null =
    sessions?.data && recentJobs?.data
      ? {
          sessions: {
            total: sessions.data.length,
            connected: sessions.data.filter((s) => s.status === 'paired').length,
            connecting: sessions.data.filter((s) => s.status === 'qr_pairing').length,
            disconnected: sessions.data.filter((s) => s.status === 'not_auth').length,
          },
          jobs: {
            total: recentJobs.data.length,
            running: recentJobs.data.filter((j) => j.status === 'processing').length,
            completed: recentJobs.data.filter((j) => j.status === 'completed').length,
            failed: recentJobs.data.filter((j) => j.status === 'failed').length,
            pending: recentJobs.data.filter((j) => j.status === 'pending').length,
          },
          messages: recentJobs.data.reduce(
            (acc, job) => ({
              total: acc.total + job.totalMessages,
              sent: acc.sent + job.processedMessages,
              failed: acc.failed + job.failedMessages,
              pending:
                acc.pending + (job.totalMessages - job.processedMessages - job.failedMessages),
            }),
            { total: 0, sent: 0, failed: 0, pending: 0 },
          ),
        }
      : null;

  const handleRefresh = () => {
    refetchSessions();
    refetchJobs();
  };

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Header */}
      <div className="flex-1 lg:flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">
            Monitor your WhatsApp sessions and messaging campaigns
          </p>
        </div>
        <div className="ml-auto flex justify-center space-x-2 pt-6 lg:pt-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? 'text-green-600' : ''}
          >
            <Activity className="h-4 w-4 mr-2" />
            Auto Refresh {autoRefresh ? 'On' : 'Off'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Sessions</CardTitle>
            <Smartphone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {sessionsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold text-green-600">
                {stats?.sessions.connected || 0}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {stats?.sessions.total || 0} total sessions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Running Jobs</CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {jobsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold text-blue-600">{stats?.jobs.running || 0}</div>
            )}
            <p className="text-xs text-muted-foreground">{stats?.jobs.total || 0} total jobs</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Messages Sent</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {jobsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold text-green-600">{stats?.messages.sent || 0}</div>
            )}
            <p className="text-xs text-muted-foreground">
              {stats?.messages.total || 0} total messages
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {jobsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {stats?.messages.total
                  ? Math.round((stats.messages.sent / stats.messages.total) * 100)
                  : 0}
                %
              </div>
            )}
            <p className="text-xs text-muted-foreground">Message delivery rate</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Separator />
      <div className="flex flex-col gap-1.5">
        <CardTitle className="flex items-center">
          <BarChart3 className="h-5 w-5 mr-2" />
          Quick Actions
        </CardTitle>
        <CardDescription>Common tasks to get you started</CardDescription>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Link to="/sessions" className="block">
          <Button variant="outline" className="w-full h-auto p-4">
            <div className="flex flex-col items-center space-y-2">
              <Smartphone className="h-6 w-6" />
              <span className="font-medium">Manage Sessions</span>
              <span className="text-xs text-muted-foreground text-center">
                Connect and manage WhatsApp sessions
              </span>
            </div>
          </Button>
        </Link>

        <Link to="/messaging" className="block">
          <Button variant="outline" className="w-full h-auto p-4">
            <div className="flex flex-col items-center space-y-2">
              <Send className="h-6 w-6" />
              <span className="font-medium">Send Messages</span>
              <span className="text-xs text-muted-foreground text-center">
                Create and send bulk messages
              </span>
            </div>
          </Button>
        </Link>

        <Link to="/jobs" className="block">
          <Button variant="outline" className="w-full h-auto p-4">
            <div className="flex flex-col items-center space-y-2">
              <Clock className="h-6 w-6" />
              <span className="font-medium">View Jobs</span>
              <span className="text-xs text-muted-foreground text-center">
                Monitor messaging campaigns
              </span>
            </div>
          </Button>
        </Link>
      </div>

      <Separator />
      {/* Sessions Overview */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center">
                <Smartphone className="h-5 w-5 mr-2" />
                WhatsApp Sessions
              </span>
              <Link to="/sessions">
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Session
                </Button>
              </Link>
            </CardTitle>
            <CardDescription>Status of your connected WhatsApp accounts</CardDescription>
          </CardHeader>
          <CardContent>
            {sessionsLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center space-x-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            ) : sessions && sessions.data.length > 0 ? (
              <div className="space-y-4">
                {sessions.data.slice(0, 5).map((session) => (
                  <Link
                    to={sessionIdRoute.to}
                    params={{ sessionId: session.id }}
                    key={session.id}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="flex-shrink-0">
                        {session.status === 'paired' ? (
                          <CheckCircle className="h-6 w-6 text-green-500" />
                        ) : session.status === 'qr_pairing' ? (
                          <Clock className="h-6 w-6 text-yellow-500" />
                        ) : (
                          <XCircle className="h-6 w-6 text-red-500" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{session.description}</p>
                        <p className="text-sm text-muted-foreground">
                          {dayjs(session.updatedAt).fromNow()}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={
                        session.status === 'paired'
                          ? 'default'
                          : session.status === 'qr_pairing'
                            ? 'secondary'
                            : 'destructive'
                      }
                    >
                      {session.status}
                    </Badge>
                  </Link>
                ))}
                {sessions.data.length > 5 && (
                  <Link to="/sessions" className="block text-center">
                    <Button variant="ghost" size="sm">
                      View all {sessions.data.length} sessions
                    </Button>
                  </Link>
                )}
              </div>
            ) : (
              <div className="text-center py-6">
                <Smartphone className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground mb-4">No sessions yet</p>
                <Link to="/sessions">
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Create First Session
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Jobs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center">
                <Clock className="h-5 w-5 mr-2" />
                Recent Jobs
              </span>
              <Link to="/jobs">
                <Button variant="outline" size="sm">
                  View All
                </Button>
              </Link>
            </CardTitle>
            <CardDescription>Latest messaging campaigns and their status</CardDescription>
          </CardHeader>
          <CardContent>
            {jobsLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </div>
                    <Skeleton className="h-2 w-full" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                ))}
              </div>
            ) : recentJobs && recentJobs.data.length > 0 ? (
              <div className="space-y-4">
                {recentJobs.data.map((job) => {
                  const progress =
                    job.totalMessages > 0
                      ? Math.round(
                          ((job.processedMessages + job.failedMessages) / job.totalMessages) * 100,
                        )
                      : 0;

                  return (
                    <div key={job.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Link
                          to="/jobs/$jobId"
                          params={{ jobId: job.id }}
                          className="font-medium hover:underline"
                        >
                          {job.name || `Job ${job.id.slice(0, 8)}`}
                        </Link>
                        <Badge
                          variant={
                            job.status === 'completed'
                              ? 'default'
                              : job.status === 'processing'
                                ? 'secondary'
                                : job.status === 'failed'
                                  ? 'destructive'
                                  : 'outline'
                          }
                        >
                          {job.status}
                        </Badge>
                      </div>
                      <Progress value={progress} className="h-2" />
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>
                          {job.processedMessages} sent / {job.totalMessages} total
                        </span>
                        <span>{dayjs(job.createdAt).fromNow()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-6">
                <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground mb-4">No jobs yet</p>
                <Link to="/messaging">
                  <Button>
                    <Send className="h-4 w-4 mr-2" />
                    Create First Campaign
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
