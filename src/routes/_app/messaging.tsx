import { createFileRoute } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useState, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { trpc } from '@/lib/trpc';
import * as XLSX from 'xlsx';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  parsePhoneNumberFromString,
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from 'libphonenumber-js';
import { toast } from 'sonner';
import { useNavigate } from '@tanstack/react-router';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Plus,
  Upload,
  Clipboard,
  X,
  Send,
  Users,
  MessageSquare,
  RefreshCw,
  FileText,
  Edit,
  Check,
  ChevronsUpDown,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageEditor } from '@/components/message-editor';
import { cn, constructMessage } from '@/lib/utils';
import { Route as jobId } from '@/routes/_app/jobs/$jobId';
import { Route as sesstionsRoute } from '@/routes/_app/sessions/index';
import { Route as jobsRoute } from '@/routes/_app/jobs/index';
import { zodValidator } from '@tanstack/zod-adapter';
import { z } from 'zod/v4';

const searchParams = z.object({
  sessionId: z.cuid2().optional(),
});

export const Route = createFileRoute('/_app/messaging')({
  validateSearch: zodValidator(searchParams),
  component: MessagingPage,
  context({ context }) {
    return {
      ...context,
      getTitle: () => 'Bulk Messaging',
    };
  },
});

interface Recipient {
  phone: string;
  data: string[];
}

interface FileColumn {
  index: number;
  name: string;
  sample?: string;
}

function CountrySelector({
  value,
  onValueChange,
}: {
  value: CountryCode;
  onValueChange: (value: CountryCode) => void;
}) {
  const [open, setOpen] = useState(false);
  const countries = getCountries();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="flex justify-between"
        >
          {`${value} (+${getCountryCallingCode(value)})`}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[180px] p-0">
        <Command>
          <CommandInput placeholder="Search country..." />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {countries.map((country) => {
                const callingCode = getCountryCallingCode(country);
                return (
                  <CommandItem
                    key={country}
                    value={[country, callingCode].join(',')}
                    onSelect={(currentValue) => {
                      const [currentCountry] = currentValue.split(',');
                      onValueChange(currentCountry as CountryCode);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === country ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    {`${country} (+${callingCode})`}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function MessagingPage() {
  const navigate = useNavigate();
  const { sessionId } = Route.useSearch();
  const [selectedSessionId, setSelectedSessionId] = useState<string>(sessionId || '');
  const [jobName, setJobName] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [template, setTemplate] = useState<(string | number)[]>(['']);
  const [manualInput, setManualInput] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [batchSize, setBatchSize] = useState(10);
  const [delay, setDelay] = useState(2000);
  const [defaultCountry, setDefaultCountry] = useState<CountryCode>('BH');
  const [removeDuplicates, setRemoveDuplicates] = useState(true);
  const [hasAddedRecipients, setHasAddedRecipients] = useState(false);
  const [hasHeaders, setHasHeaders] = useState(true);
  const [usedMethod, setUsedMethod] = useState<'file' | 'clipboard' | 'manual' | null>(null);

  // File upload states
  const [fileData, setFileData] = useState<string[][]>([]);
  const [fileColumns, setFileColumns] = useState<FileColumn[]>([]);
  const [selectedPhoneColumn, setSelectedPhoneColumn] = useState<number>(-1);
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const recipientsParentRef = useRef<HTMLDivElement>(null);

  // Virtual scrolling for recipients list
  const rowVirtualizer = useVirtualizer({
    count: recipients.length,
    getScrollElement: () => recipientsParentRef.current,
    estimateSize: () => 40, // Estimated height of each recipient item
    overscan: 5,
    gap: 4,
  });

  // Fetch paired sessions
  const { data: sessionsResponse, isLoading: sessionsLoading } = useQuery(
    trpc.sessions.getSessions.queryOptions(),
  );

  const sessions = sessionsResponse?.data || [];
  const pairedSessions = sessions.filter((session) => session.status === 'paired');

  // Send bulk mutation
  const sendBulkMutation = useMutation(
    trpc.bulk.sendBulk.mutationOptions({
      onSuccess: ({ data }) => {
        toast.success('Bulk messaging job created successfully!');
        // Navigate to jobs page to view progress
        navigate({ to: jobId.to, params: { jobId: data.jobId } });
      },
      onError: (error) => {
        toast.error(`Failed to create bulk messaging job: ${error.message}`);
      },
    }),
  );

  // Available columns for template (based on file data)
  const availableColumns =
    fileColumns.length > 0
      ? fileColumns.map((col) => ({
          index: col.index,
          name: col.name,
        }))
      : [];

  // Parse contacts from uploaded file and show column selector
  async function parseFileForColumns(file: File): Promise<void> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];

        if (rows.length === 0) {
          toast.error('File is empty');
          return;
        }

        // Determine the maximum number of columns
        const maxColumns = Math.max(...rows.map((row) => row.length));

        // Create column definitions based on header preference
        const columns: FileColumn[] = [];
        for (let i = 0; i < maxColumns; i++) {
          const headerName =
            hasHeaders && rows[0] && rows[0][i] ? String(rows[0][i]).trim() : `Column ${i + 1}`;

          // Get sample data from first data row (skip header if present)
          const sampleRowIndex = hasHeaders ? 1 : 0;
          const sample =
            rows[sampleRowIndex] && rows[sampleRowIndex][i]
              ? String(rows[sampleRowIndex][i]).trim()
              : '';

          columns.push({
            index: i,
            name: headerName || `Column ${i + 1}`,
            sample: sample,
          });
        }

        setFileData(rows);
        setFileColumns(columns);
        setShowColumnSelector(true);
        resolve();
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // Parse contacts from file data after column selection
  function parseContactsFromFileData(): Recipient[] {
    if (selectedPhoneColumn === -1 || fileData.length === 0) return [];

    const recipients: Recipient[] = [];

    // Start from the appropriate row (skip header if present)
    const startRow = hasHeaders ? 1 : 0;
    for (let i = startRow; i < fileData.length; i++) {
      const row = fileData[i];
      if (!row || row.length === 0) continue;

      const phone = String(row[selectedPhoneColumn] || '').trim();
      if (!phone) continue;

      const data = row.map((cell) => {
        return String(cell || '').trim();
      });

      recipients.push({ phone, data });
    }

    return recipients;
  }

  // Parse structured data (from clipboard or manual input) into columns
  function parseStructuredData(text: string): { rows: string[][]; maxColumns: number } {
    const lines = text
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const rows: string[][] = lines.map((line) => {
      return line
        .split(/,|;|\t/)
        .map((p) => p.trim())
        .filter(Boolean);
    });
    const maxColumns = Math.max(...rows.map((row) => row.length));
    return { rows, maxColumns };
  }

  // Setup column selection for structured data
  function setupColumnsForStructuredData(
    rows: string[][],
    maxColumns: number,
    method: 'clipboard' | 'manual',
  ) {
    const columns: FileColumn[] = [];
    for (let i = 0; i < maxColumns; i++) {
      const sampleRowIndex = hasHeaders ? 1 : 0;
      const headerName =
        hasHeaders && rows[0] && rows[0][i] ? String(rows[0][i]).trim() : `Column ${i + 1}`;
      const sample =
        rows[sampleRowIndex] && rows[sampleRowIndex][i]
          ? String(rows[sampleRowIndex][i]).trim()
          : '';

      columns.push({
        index: i,
        name: headerName || `Column ${i + 1}`,
        sample: sample,
      });
    }

    setFileData(rows);
    setFileColumns(columns);
    setShowColumnSelector(true);
  }

  // Validate phone numbers
  function validateRecipients(recipients: Recipient[]) {
    const validRecipients: Recipient[] = [];
    const invalidNumbers: string[] = [];

    for (const recipient of recipients) {
      const phoneNumber = parsePhoneNumberFromString(recipient.phone, defaultCountry);
      if (phoneNumber && phoneNumber.isValid()) {
        validRecipients.push({
          phone: phoneNumber.number.replace('+', ''),
          data: recipient.data,
        });
      } else {
        invalidNumbers.push(recipient.phone);
      }
    }

    return { validRecipients, invalidNumbers };
  }

  // Add recipients from various sources
  const addRecipientsToList = (
    newRecipients: Recipient[],
    method: 'file' | 'clipboard' | 'manual',
  ) => {
    const { validRecipients, invalidNumbers } = validateRecipients(newRecipients);

    let addedRecipients: Recipient[] = [];
    let duplicateCount = 0;

    // Handle duplicates within the new list based on user preference
    if (removeDuplicates) {
      const phoneToRecipient = new Map<string, Recipient>();

      // Process all recipients, later entries will overwrite earlier ones
      validRecipients.forEach((recipient) => {
        phoneToRecipient.set(recipient.phone, recipient);
      });

      // Get the unique recipients (keeping the latest occurrence)
      const uniqueRecipients = Array.from(phoneToRecipient.values());
      duplicateCount = validRecipients.length - uniqueRecipients.length;
      addedRecipients = uniqueRecipients;
    } else {
      addedRecipients = validRecipients;
    }

    // Add to existing recipients
    setRecipients((prev) => [...prev, ...addedRecipients]);

    // Show appropriate toast messages
    if (validRecipients.length === 0) {
      // No valid recipients at all
      toast.error(`No valid phone numbers found`);
    } else {
      // There are valid recipients
      if (invalidNumbers.length > 0 || duplicateCount > 0) {
        // Show warning if there are issues but valid numbers were added
        let warningMessage = `Added ${addedRecipients.length} valid recipients.`;
        if (invalidNumbers.length > 0) {
          warningMessage += ` ${invalidNumbers.length} invalid numbers ignored.`;
        }
        if (duplicateCount > 0) {
          warningMessage += ` ${duplicateCount} duplicates removed.`;
        }
        toast.warning(warningMessage, { duration: 6000 });
      } else {
        // Success - all numbers were valid and added
        toast.success(`Added ${addedRecipients.length} recipients successfully`);
      }
    }

    if (validRecipients.length > 0) {
      setHasAddedRecipients(true);
    }

    return validRecipients.length > 0;
  };

  // Handle file upload
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      try {
        await parseFileForColumns(file);
        toast.success('File parsed successfully. Please select the phone number column.');
      } catch (error) {
        toast.error('Failed to parse file');
      }
    }
  }

  // Handle column selection confirmation
  function handleColumnSelection() {
    if (selectedPhoneColumn === -1) {
      toast.error('Please select the phone number column');
      return;
    }

    const recipients = parseContactsFromFileData();
    const currentMethod = usedMethod || 'file';
    addRecipientsToList(recipients, currentMethod);

    // Keep the column data for template usage but close the selector
    setShowColumnSelector(false);

    // Clear manual input if it was used
    if (currentMethod === 'manual') {
      setManualInput('');
    }
  }

  // Handle clipboard paste
  function handleClipboard() {
    navigator.clipboard
      .readText()
      .then((text) => {
        const { rows, maxColumns } = parseStructuredData(text);
        if (rows.length === 0) {
          toast.error('No data found in clipboard');
          return;
        }
        if (maxColumns === 1) {
          // Simple phone list - add directly
          const recipients: Recipient[] = rows.map((row) => ({
            phone: row[0] || '',
            data: [],
          }));
          addRecipientsToList(recipients, 'clipboard');
        } else {
          // Structured data - show column selector
          setupColumnsForStructuredData(rows, maxColumns, 'clipboard');
        }
      })
      .catch(() => {
        toast.error('Failed to read clipboard');
      });
  }

  // Handle manual input
  function handleManualAdd() {
    if (!manualInput.trim()) {
      toast.error('Please enter some data');
      return;
    }

    const { rows, maxColumns } = parseStructuredData(manualInput);
    if (rows.length === 0) {
      toast.error('No valid data found');
      return;
    }

    if (maxColumns === 1) {
      // Simple phone list - add directly
      const recipients: Recipient[] = rows.map((row) => ({
        phone: row[0] || '',
        data: [],
      }));
      addRecipientsToList(recipients, 'manual');
      setManualInput('');
    } else {
      // Structured data - show column selector
      setupColumnsForStructuredData(rows, maxColumns, 'manual');
    }
  }

  // Remove recipient
  const removeRecipient = (index: number) => {
    if (recipients.length === 1) {
      clearRecipients();
    } else {
      setRecipients((prev) => prev.filter((_, i) => i !== index));
    }
  };

  // Clear all recipients
  const clearRecipients = () => {
    setRecipients([]);
    setHasAddedRecipients(false);
    setUsedMethod(null);

    // Clear file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    // Clear file-related data
    setFileData([]);
    setFileColumns([]);
    setSelectedPhoneColumn(-1);
    setShowColumnSelector(false);

    // Clear manual input
    setManualInput('');
  };

  // Handle send
  const handleSend = () => {
    if (!selectedSessionId) {
      toast.error('Please select a WhatsApp session');
      return;
    }
    if (!jobName.trim()) {
      toast.error('Please enter a job name');
      return;
    }
    if (recipients.length === 0) {
      toast.error('Please add at least one recipient');
      return;
    }
    if (!template.some((part) => typeof part === 'string' && part.trim())) {
      toast.error('Please create a message template');
      return;
    }

    sendBulkMutation.mutate({
      sessionId: selectedSessionId,
      name: jobName.trim(),
      recipients: recipients.map((r) => ({
        phone: r.phone,
        data: r.data,
      })),
      template,
      batchSize,
      delay,
    });
  };

  if (sessionsLoading) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-3/4" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (pairedSessions.length === 0) {
    return (
      <div className="container mx-auto p-6">
        <Card className="text-center py-12">
          <CardContent>
            <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Connected Sessions</h3>
            <p className="text-muted-foreground mb-4">
              You need to connect a WhatsApp session before you can send bulk messages.
            </p>
            <Button onClick={() => navigate({ to: sesstionsRoute.to })}>
              Connect WhatsApp Session
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Bulk Messaging</h1>
          <p className="text-muted-foreground">Send messages to multiple recipients</p>
        </div>
        <Button variant="outline" onClick={() => navigate({ to: jobsRoute.to })}>
          <RefreshCw className="h-4 w-4 mr-2" />
          View Jobs
        </Button>
      </div>

      {/* Session Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Session Selection
          </CardTitle>
          <CardDescription>Choose which WhatsApp session to send messages from</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="session">WhatsApp Session</Label>
            <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a connected session" />
              </SelectTrigger>
              <SelectContent>
                {pairedSessions.map((session) => (
                  <SelectItem key={session.id} value={session.id}>
                    <div className="flex items-center gap-2">
                      <Badge variant="default" className="bg-green-600">
                        Connected
                      </Badge>
                      <span>{session.description}</span>
                      {session.phone && (
                        <>
                          <span className="text-muted-foreground">
                            ({`${session.phone} - ${session.name}`})
                          </span>
                        </>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="jobName">Job Name</Label>
            <Input
              id="jobName"
              placeholder="Enter a name for this messaging job"
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="country">Default Country</Label>
            <CountrySelector value={defaultCountry} onValueChange={setDefaultCountry} />
            <p className="text-sm text-muted-foreground">
              Default country for phone number validation
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Recipients */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Recipients ({recipients.length})
          </CardTitle>
          <CardDescription>Add phone numbers and data for your recipients</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/50">
            <div className="space-y-1">
              <Label htmlFor="removeDuplicates" className="text-sm font-medium">
                Remove Duplicates
              </Label>
              <p className="text-xs text-muted-foreground">
                Automatically remove duplicate phone numbers when adding recipients
              </p>
            </div>
            <Switch
              id="removeDuplicates"
              checked={removeDuplicates}
              onCheckedChange={setRemoveDuplicates}
              disabled={hasAddedRecipients}
            />
          </div>

          <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/50">
            <div className="space-y-1">
              <Label htmlFor="hasHeaders" className="text-sm font-medium">
                First Row is Headers
              </Label>
              <p className="text-xs text-muted-foreground">
                Check if the first row contains column headers instead of data
              </p>
            </div>
            <Switch
              id="hasHeaders"
              checked={hasHeaders}
              onCheckedChange={setHasHeaders}
              disabled={hasAddedRecipients}
            />
          </div>
          <Tabs defaultValue="file" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger
                value="file"
                className="flex items-center gap-2"
                disabled={hasAddedRecipients}
              >
                <FileText className="h-4 w-4" />
                File Upload
              </TabsTrigger>
              <TabsTrigger
                value="clipboard"
                className="flex items-center gap-2"
                disabled={hasAddedRecipients}
              >
                <Clipboard className="h-4 w-4" />
                Clipboard
              </TabsTrigger>
              <TabsTrigger
                value="manual"
                className="flex items-center gap-2"
                disabled={hasAddedRecipients}
              >
                <Edit className="h-4 w-4" />
                Manual
              </TabsTrigger>
            </TabsList>

            <TabsContent value="file" className="space-y-4">
              <div className="space-y-2">
                <Label>Upload File (CSV/Excel)</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    ref={fileInputRef}
                    onChange={handleFile}
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-2" />
                    Choose File
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Upload a CSV or Excel file. You'll be able to select which column contains phone
                  numbers.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="clipboard" className="space-y-4">
              <div className="space-y-2">
                <Label>Paste from Clipboard</Label>
                <Button onClick={handleClipboard} className="w-full" disabled={hasAddedRecipients}>
                  <Clipboard className="h-4 w-4 mr-2" />
                  Paste from Clipboard
                </Button>
                <p className="text-sm text-muted-foreground">
                  Paste comma-separated data from your clipboard (phone, data1, data2, ...)
                </p>
              </div>
            </TabsContent>

            <TabsContent value="manual" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="manualInput">Manual Input</Label>
                <Textarea
                  id="manualInput"
                  placeholder="Enter recipients (one per line, comma-separated for data)&#10;Example:&#10;+1234567890,John,Smith&#10;+0987654321,Jane,Doe"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  rows={6}
                  disabled={hasAddedRecipients}
                />
                <Button
                  onClick={handleManualAdd}
                  disabled={!manualInput.trim() || hasAddedRecipients}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Recipients
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          {/* Column Selector Dialog */}
          <AlertDialog open={showColumnSelector} onOpenChange={setShowColumnSelector}>
            <AlertDialogContent className="max-w-2xl">
              <AlertDialogHeader>
                <AlertDialogTitle>Select Phone Number Column</AlertDialogTitle>
                <AlertDialogDescription>
                  Please select which column contains the phone numbers from your uploaded file.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-4">
                <div className="grid gap-2 max-h-96 overflow-y-auto">
                  {fileColumns.map((column) => (
                    <div
                      key={column.index}
                      className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                        selectedPhoneColumn === column.index
                          ? 'border-primary bg-primary/10'
                          : 'border-muted hover:border-muted-foreground'
                      }`}
                      onClick={() => setSelectedPhoneColumn(column.index)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-3 h-3 rounded-full border-2 ${
                              selectedPhoneColumn === column.index
                                ? 'bg-primary border-primary'
                                : 'border-muted-foreground'
                            }`}
                          />
                          <span className="font-medium">{column.name}</span>
                        </div>
                        <Badge variant="secondary">Column {column.index + 1}</Badge>
                      </div>
                      {column.sample && (
                        <p className="text-sm text-muted-foreground mt-1 ml-5">
                          Sample: {column.sample}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel
                  onClick={() => {
                    setShowColumnSelector(false);
                    setFileData([]);
                    setFileColumns([]);
                    setSelectedPhoneColumn(-1);
                  }}
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction onClick={handleColumnSelection}>Continue</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Recipients List */}
          {recipients.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Recipients List</Label>
                <Button variant="destructive" size="sm" onClick={clearRecipients}>
                  Clear All
                </Button>
              </div>
              <div ref={recipientsParentRef} className="h-40 overflow-auto border rounded-md">
                <div
                  className="w-full relative"
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                    const recipient = recipients[virtualItem.index];
                    return (
                      <div
                        key={virtualItem.key}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: `${virtualItem.size}px`,
                          transform: `translateY(${virtualItem.start}px)`,
                        }}
                        className="flex items-center justify-between bg-secondary rounded px-2 py-1"
                      >
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-sm">{recipient.phone}</span>
                          {recipient.data.length > 0 && (
                            <span className="text-xs text-muted-foreground ml-2">
                              [{recipient.data.join(', ')}]
                            </span>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeRecipient(virtualItem.index)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Message Template */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Message Template
          </CardTitle>
          <CardDescription>
            Create your message template with variable placeholders. Type @ to insert column data
            from your uploaded file.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MessageEditor value={template} onChange={setTemplate} columns={availableColumns} />
          <div className="text-sm text-muted-foreground space-y-1">
            <p>• Type @ to insert column data from your uploaded file</p>
            <p>
              • Available columns:{' '}
              {availableColumns.length > 0
                ? availableColumns.map((col) => col.name).join(', ')
                : 'Upload a file first'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Advanced Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Advanced Settings</CardTitle>
          <CardDescription>Configure batch processing and delays</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="batchSize">Batch Size</Label>
              <Input
                id="batchSize"
                type="number"
                min={1}
                max={50}
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">Messages per batch (1-500)</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="delay">Delay (ms)</Label>
              <Input
                id="delay"
                type="number"
                min={500}
                max={10000}
                step={500}
                value={delay}
                onChange={(e) => setDelay(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">Delay between batches (500-10000ms)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Send Button */}
      <Card>
        <CardContent className="pt-6">
          <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
            <AlertDialogTrigger asChild>
              <Button
                className="w-full"
                size="lg"
                disabled={
                  !selectedSessionId ||
                  !jobName.trim() ||
                  recipients.length === 0 ||
                  sendBulkMutation.isPending
                }
                onClick={() => setShowConfirm(true)}
              >
                {sendBulkMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Creating Job...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send Bulk Messages
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-w-2xl">
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Bulk Messaging Job</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-4">
                    <p>You are about to create a bulk messaging job with the following details:</p>
                    <div className="bg-secondary rounded p-3 space-y-1 text-sm">
                      <div>
                        <strong>Job Name:</strong> {jobName}
                      </div>
                      <div>
                        <strong>Recipients:</strong> {recipients.length} contacts
                      </div>
                      <div>
                        <strong>Session:</strong>{' '}
                        {pairedSessions.find((s) => s.id === selectedSessionId)?.description}
                      </div>
                      <div>
                        <strong>Batch Size:</strong> {batchSize} messages per batch
                      </div>
                      <div>
                        <strong>Delay:</strong> {delay}ms between batches
                      </div>
                    </div>

                    {/* Message Preview */}
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium">Message Preview:</h4>
                      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded p-3">
                        <div className="text-xs text-blue-600 dark:text-blue-400 mb-1">
                          Example message (using sample data):
                        </div>
                        <div className="text-sm whitespace-pre-wrap break-words">
                          {template.length > 0 && recipients.length > 0
                            ? constructMessage(template, recipients[0]?.data)
                            : template.length > 0
                              ? constructMessage(template)
                              : 'No message template defined'}
                        </div>
                      </div>
                    </div>

                    <p className="text-sm text-amber-600">
                      ⚠️ This action cannot be undone. Make sure your message template and
                      recipients are correct.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setShowConfirm(false);
                    handleSend();
                  }}
                >
                  Create Job
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
