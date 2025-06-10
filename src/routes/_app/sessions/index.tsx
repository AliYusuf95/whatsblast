import { createFileRoute, Link } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Plus, QrCode, Trash2, RefreshCw, Smartphone } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Route as sessionId } from '@/routes/_app/sessions/$sessionId';

// Initialize dayjs plugin
dayjs.extend(relativeTime);

export const Route = createFileRoute('/_app/sessions/')({
  component: SessionsPage,
  context({ context }) {
    return {
      ...context,
      getTitle: () => undefined,
    };
  },
});

interface Session {
  id: string;
  description: string;
  status: 'not_auth' | 'qr_pairing' | 'paired';
  phone?: string | null;
  name?: string | null;
  lastUsedAt: string | null;
  createdAt: string | null;
}

function SessionsPage() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createDescription, setCreateDescription] = useState('');

  // Fetch sessions
  const {
    data: sessionsResponse,
    isLoading,
    refetch,
  } = useQuery(trpc.sessions.getSessions.queryOptions());

  const sessions = sessionsResponse?.data || [];

  // Create session mutation
  const createSessionMutation = useMutation(
    trpc.sessions.createSession.mutationOptions({
      onSuccess: () => {
        toast.success('Session created successfully');
        setIsCreateDialogOpen(false);
        setCreateDescription('');
        refetch();
      },
      onError: (error) => {
        toast.error(`Failed to create session: ${error.message}`);
      },
    }),
  );

  // Delete session mutation
  const deleteSessionMutation = useMutation(
    trpc.sessions.deleteSession.mutationOptions({
      onSuccess: () => {
        toast.success('Session deleted successfully');
        refetch();
      },
      onError: (error) => {
        toast.error(`Failed to delete session: ${error.message}`);
      },
    }),
  );

  const handleCreateSession = () => {
    if (!createDescription.trim()) {
      toast.error('Please enter a description');
      return;
    }

    createSessionMutation.mutate({
      description: createDescription.trim(),
    });
  };

  const handleDeleteSession = (sessionId: string) => {
    deleteSessionMutation.mutate({ sessionId });
  };

  const getStatusBadge = (status: Session['status']) => {
    switch (status) {
      case 'not_auth':
        return <Badge variant="secondary">Not Connected</Badge>;
      case 'qr_pairing':
        return <Badge variant="outline">Pairing</Badge>;
      case 'paired':
        return <Badge variant="default">Connected</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const getStatusIcon = (status: Session['status']) => {
    switch (status) {
      case 'paired':
        return <Smartphone className="h-4 w-4 text-green-600" />;
      case 'qr_pairing':
        return <QrCode className="h-4 w-4 text-blue-600" />;
      default:
        return <RefreshCw className="h-4 w-4 text-gray-500" />;
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">WhatsApp Sessions</h1>
          <p className="text-muted-foreground">
            Manage your WhatsApp connections for bulk messaging
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Session
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Session</DialogTitle>
              <DialogDescription>
                Create a new WhatsApp session for bulk messaging. You'll need to scan a QR code to
                connect.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  placeholder="e.g., Business Account, Personal, Marketing..."
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateSession();
                    }
                  }}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsCreateDialogOpen(false)}
                disabled={createSessionMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateSession}
                disabled={createSessionMutation.isPending || !createDescription.trim()}
              >
                {createSessionMutation.isPending ? 'Creating...' : 'Create Session'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Sessions Grid */}
      {sessions.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Smartphone className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Sessions Yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first WhatsApp session to start sending bulk messages
            </p>
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Session
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              onDelete={handleDeleteSession}
              isDeleting={deleteSessionMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface SessionCardProps {
  session: Session;
  onDelete: (sessionId: string) => void;
  isDeleting: boolean;
}

function SessionCard({ session, onDelete, isDeleting }: SessionCardProps) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-2">
            {getStatusIcon(session.status)}
            <div>
              <CardTitle className="text-lg">{session.description}</CardTitle>
              <div className="flex items-center space-x-2 mt-1">
                {getStatusBadge(session.status)}
              </div>
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" disabled={isDeleting}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Session</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete "{session.description}"? This action cannot be
                  undone and will remove all associated data.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onDelete(session.id)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {session.status === 'paired' && session.phone && (
          <div className="text-sm">
            <p className="font-medium">{session.name}</p>
            <p className="text-muted-foreground">{session.phone}</p>
          </div>
        )}

        <div className="text-xs text-muted-foreground space-y-1">
          {session.lastUsedAt && <p>Last used: {dayjs(session.lastUsedAt).fromNow()}</p>}
          {session.createdAt && <p>Created: {dayjs(session.createdAt).fromNow()}</p>}
        </div>

        <div className="flex justify-between items-center pt-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={sessionId.to} params={{ sessionId: session.id }}>
              {session.status === 'paired' ? 'Manage' : 'Connect'}
            </Link>
          </Button>

          {session.status === 'paired' && (
            <Button size="sm" asChild>
              <Link to={`/messaging`} search={{ sessionId: session.id }}>
                Send Messages
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Helper functions moved outside component for better performance
function getStatusBadge(status: Session['status']) {
  switch (status) {
    case 'not_auth':
      return <Badge variant="secondary">Not Connected</Badge>;
    case 'qr_pairing':
      return <Badge variant="outline">Pairing</Badge>;
    case 'paired':
      return <Badge variant="default">Connected</Badge>;
    default:
      return <Badge variant="secondary">Unknown</Badge>;
  }
}

function getStatusIcon(status: Session['status']) {
  switch (status) {
    case 'paired':
      return <Smartphone className="h-4 w-4 text-green-600" />;
    case 'qr_pairing':
      return <QrCode className="h-4 w-4 text-blue-600" />;
    default:
      return <RefreshCw className="h-4 w-4 text-gray-500" />;
  }
}
