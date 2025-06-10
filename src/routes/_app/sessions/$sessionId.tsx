import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
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
  ArrowLeft,
  QrCode,
  RefreshCw,
  Smartphone,
  Trash2,
  CheckCircle,
  Clock,
  AlertCircle,
  MessageCircle,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Route as sesstionsRoute } from '@/routes/_app/sessions/index';

// Initialize dayjs plugin
dayjs.extend(relativeTime);

export const Route = createFileRoute('/_app/sessions/$sessionId')({
  component: SessionDetailPage,
  context({ context }) {
    return {
      ...context,
      getTitle: () => 'Session Details',
    };
  },
});

interface SessionStatus {
  session: {
    id: string;
    userId: string;
    description: string;
    status: 'not_auth' | 'qr_pairing' | 'paired';
    phone?: string | null;
    name?: string | null;
    qrCode?: string | null;
    qrExpiresAt?: string | null;
    lastUsedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  };
  connection: {
    state: string;
    isConnected: boolean;
  };
  qr: {
    code?: string | null;
    expired: boolean;
    expiresAt?: string | null;
  };
}

function SessionDetailPage() {
  const { sessionId } = Route.useParams();
  const navigate = useNavigate();

  // Fetch session status with real-time updates
  const {
    data: statusResponse,
    isLoading,
    refetch: refetchStatus,
  } = useQuery({
    ...trpc.sessions.getSessionStatus.queryOptions({ sessionId }),
    refetchInterval: 3000, // Refresh every 3 seconds
    enabled: !!sessionId,
  });

  const status: SessionStatus | null = statusResponse?.data || null;

  // Request QR code mutation
  const requestQRMutation = useMutation(
    trpc.sessions.requestQR.mutationOptions({
      onSuccess: () => {
        toast.success('QR code requested. Please wait...');
        refetchStatus();
      },
      onError: (error) => {
        toast.error(`Failed to request QR code: ${error.message}`);
      },
    }),
  );

  const allowQRGeneration =
    status?.session.status === 'not_auth' &&
    !requestQRMutation.isPending &&
    !['connecting', 'waiting_qr'].includes(status.connection.state);

  // Validate session mutation
  const validateSessionMutation = useMutation(
    trpc.sessions.validateSession.mutationOptions({
      onSuccess: () => {
        toast.success('Session validation requested');
        refetchStatus();
      },
      onError: (error) => {
        toast.error(`Failed to validate session: ${error.message}`);
      },
    }),
  );

  // Delete session mutation
  const deleteSessionMutation = useMutation(
    trpc.sessions.deleteSession.mutationOptions({
      onSuccess: () => {
        toast.success('Session deleted successfully');
        navigate({ to: sesstionsRoute.to });
      },
      onError: (error) => {
        toast.error(`Failed to delete session: ${error.message}`);
      },
    }),
  );

  // Auto-refresh QR code when it expires
  useEffect(() => {
    if (status?.qr.expired && status?.session.status === 'qr_pairing') {
      const timer = setTimeout(() => {
        handleRequestQR();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [status?.qr.expired]);

  const handleRequestQR = () => {
    requestQRMutation.mutate({ sessionId });
  };

  const handleValidateSession = () => {
    validateSessionMutation.mutate({ sessionId });
  };

  const handleDeleteSession = () => {
    deleteSessionMutation.mutate({ sessionId });
  };

  const getStatusInfo = (status: SessionStatus['session']['status']) => {
    switch (status) {
      case 'not_auth':
        return {
          badge: <Badge variant="secondary">Not Connected</Badge>,
          icon: <RefreshCw className="h-5 w-5 text-gray-500" />,
          color: 'text-gray-600',
          description: 'Session is not authenticated. Generate a QR code to connect.',
        };
      case 'qr_pairing':
        return {
          badge: <Badge variant="outline">Waiting for QR Scan</Badge>,
          icon: <QrCode className="h-5 w-5 text-blue-600" />,
          color: 'text-blue-600',
          description: 'QR code generated. Scan with your WhatsApp to connect.',
        };
      case 'paired':
        return {
          badge: (
            <Badge variant="default" className="bg-green-600">
              Connected
            </Badge>
          ),
          icon: <Smartphone className="h-5 w-5 text-green-600" />,
          color: 'text-green-600',
          description: 'Session is connected and ready for messaging.',
        };
      default:
        return {
          badge: <Badge variant="secondary">Unknown</Badge>,
          icon: <AlertCircle className="h-5 w-5 text-gray-500" />,
          color: 'text-gray-600',
          description: 'Session status unknown.',
        };
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center space-x-4">
          <Skeleton className="h-10 w-10" />
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="container mx-auto p-6">
        <Card className="text-center py-12">
          <CardContent>
            <AlertCircle className="h-12 w-12 mx-auto text-red-500 mb-4" />
            <h3 className="text-lg font-semibold mb-2">Session Not Found</h3>
            <p className="text-muted-foreground mb-4">
              The session you're looking for doesn't exist or you don't have access to it.
            </p>
            <Button onClick={() => navigate({ to: sesstionsRoute.to })}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Sessions
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusInfo = getStatusInfo(status.session.status);

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="outline" size="sm" onClick={() => navigate({ to: sesstionsRoute.to })}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <div className="flex items-center space-x-3">
              {statusInfo.icon}
              <h1 className="text-2xl font-bold">{status.session.description}</h1>
            </div>
            <div className="flex items-center space-x-3 mt-2">
              {statusInfo.badge}
              <span className="text-sm text-muted-foreground">
                Created {dayjs(status.session.createdAt).fromNow()}
              </span>
            </div>
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Session
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Session</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{status.session.description}"? This action cannot
                be undone and will remove all associated data.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteSession}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <p className="text-muted-foreground">{statusInfo.description}</p>

      {/* Main Content Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* QR Code Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <QrCode className="h-5 w-5" />
              <span>WhatsApp Connection</span>
            </CardTitle>
            <CardDescription>
              {status.session.status === 'paired'
                ? 'Your WhatsApp is connected and ready'
                : 'Scan the QR code with WhatsApp to connect'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {status.session.status === 'paired' ? (
              <div className="text-center py-8">
                <CheckCircle className="h-16 w-16 mx-auto text-green-600 mb-4" />
                <h3 className="text-lg font-semibold text-green-600 mb-2">Connected!</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Your WhatsApp account is connected and ready for messaging
                </p>
                <Button
                  variant="outline"
                  onClick={handleValidateSession}
                  disabled={validateSessionMutation.isPending}
                >
                  {validateSessionMutation.isPending ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Validating...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Validate Connection
                    </>
                  )}
                </Button>
              </div>
            ) : status.qr.code && !status.qr.expired && status.session.status === 'qr_pairing' ? (
              <div className="text-center space-y-4">
                <div className="bg-white p-4 rounded-lg inline-block">
                  <img src={status.qr.code} alt="WhatsApp QR Code" className="w-48 h-48 mx-auto" />
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Scan this QR code with WhatsApp</p>
                  <p className="text-xs text-muted-foreground">
                    Open WhatsApp → Settings → Linked Devices → Link a Device
                  </p>
                  {status.qr.expiresAt && (
                    <p className="text-xs text-muted-foreground">
                      Expires {dayjs(status.qr.expiresAt).fromNow()}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 space-y-4">
                {!allowQRGeneration ? (
                  <Spinner className="h-16 w-16 mx-auto text-muted-foreground" />
                ) : (
                  <Clock className="h-16 w-16 mx-auto text-muted-foreground" />
                )}
                <div>
                  <h3 className="text-lg font-semibold mb-2">Generate QR Code</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {status.qr.expired
                      ? 'QR code has expired. Generate a new one to connect.'
                      : 'Click the button below to generate a QR code for WhatsApp connection.'}
                  </p>
                  <Button onClick={handleRequestQR} disabled={!allowQRGeneration}>
                    {!allowQRGeneration ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <QrCode className="h-4 w-4 mr-2" />
                        Generate QR Code
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Session Info */}
        <Card>
          <CardHeader>
            <CardTitle>Session Information</CardTitle>
            <CardDescription>Details about this WhatsApp session</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Status</label>
                <div className="mt-1">{statusInfo.badge}</div>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground">Description</label>
                <p className="mt-1">{status.session.description}</p>
              </div>

              {status.session.phone && (
                <>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      Phone Number
                    </label>
                    <p className="mt-1 font-mono">{status.session.phone}</p>
                  </div>

                  {status.session.name && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        Account Name
                      </label>
                      <p className="mt-1">{status.session.name}</p>
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Connection State
                </label>
                <p className="mt-1 capitalize">{status.connection.state}</p>
              </div>

              {status.session.lastUsedAt && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Last Used</label>
                  <p className="mt-1">{dayjs(status.session.lastUsedAt).fromNow()}</p>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-muted-foreground">Created</label>
                <p className="mt-1">{dayjs(status.session.createdAt).fromNow()}</p>
              </div>
            </div>

            {status.session.status === 'paired' && (
              <div className="pt-4 border-t">
                <Button asChild className="w-full">
                  <Link to={'/messaging'} search={{ sessionId }}>
                    <MessageCircle className="h-4 w-4 mr-2" />
                    Start Bulk Messaging
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
