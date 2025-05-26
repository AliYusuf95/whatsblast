import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, useRef, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import * as XLSX from "xlsx";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import {
  parsePhoneNumberFromString,
  getCountries,
  getCountryCallingCode,
  formatIncompletePhoneNumber,
  type CountryCode,
} from "libphonenumber-js";
import { toast } from "sonner";
import { useRouter } from "@tanstack/react-router";
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
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MessageEditor } from "@/components/message-editor";

type FileData = {
  headers: string[];
  rows: any[][];
  selectedColumns: number[];
};

export const Route = createFileRoute("/bulk-template")({
  component: BulkTemplate,
});

export function BulkTemplate() {
  const router = useRouter();
  const { data: loggedIn, isLoading: loginLoading } = useQuery(
    trpc.checkLogin.queryOptions()
  );
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [message, setMessage] = useState<(string | number)[]>([]);
  const [submitId, setSubmitId] = useState<string | null>(null);
  const [defaultCountry, setDefaultCountry] = useState<CountryCode>("BH");
  const [hasHeaders, setHasHeaders] = useState(true);
  const [selectedPhoneColumn, setSelectedPhoneColumn] = useState<number | null>(
    null
  );

  const { data: contactInfo } = useQuery(
    trpc.getContactInfo.queryOptions(undefined, {
      enabled: loggedIn,
      refetchInterval: 2000,
    })
  );

  const sendMutation = useMutation(
    trpc.sendBulkMessages.mutationOptions({
      onSuccess: (data) => setSubmitId(data.submitId),
    })
  );

  const { data: progress } = useQuery(
    trpc.getBulkProgress.queryOptions(submitId ? { submitId } : skipToken, {
      enabled: !!submitId,
      refetchInterval: 2000,
    })
  );

  if (loginLoading) return <div>Loading...</div>;
  if (!loggedIn) {
    router.navigate({ to: "/login" });
    return null;
  }

  return (
    <div className="container mx-auto p-8">
      {contactInfo && (
        <div className="mb-4 p-4 rounded bg-muted text-sm text-muted-foreground flex items-center gap-4">
          <span className="font-semibold">Logged in as:</span>
          <span>
            {contactInfo.name} ({contactInfo.number})
          </span>
        </div>
      )}
      {submitId ? (
        <SubmissionProgress
          progress={progress}
          onNewSubmission={() => {
            setSubmitId(null);
            setFileData(null);
            setMessage([]);
            setSelectedPhoneColumn(null);
          }}
        />
      ) : (
        <TemplateForm
          fileData={fileData}
          setFileData={setFileData}
          message={message}
          setMessage={setMessage}
          defaultCountry={defaultCountry}
          setDefaultCountry={setDefaultCountry}
          hasHeaders={hasHeaders}
          setHasHeaders={setHasHeaders}
          selectedPhoneColumn={selectedPhoneColumn}
          setSelectedPhoneColumn={setSelectedPhoneColumn}
          onSubmit={(validRows) => {
            if (!fileData || selectedPhoneColumn === null) return;

            // Extract phone numbers from validRows
            const numbers = validRows.map((row) => {
              const phoneNumber = parsePhoneNumberFromString(
                String(row[selectedPhoneColumn]),
                defaultCountry
              );
              return phoneNumber!.number.replace("+", "");
            });
            // Get unique column indices in the order they first appear
            const orderedIndices: number[] = [];
            message.forEach((part) => {
              if (typeof part === "number" && !orderedIndices.includes(part)) {
                orderedIndices[part] = part;
              }
            });

            // Extract data in the order columns appear in the message
            const data = validRows.map((row) => {
              // Return values in the same order as the indices
              return orderedIndices.map((index) =>
                typeof index === "number" ? String(row[index]) : ""
              );
            });

            sendMutation.mutate({
              message,
              numbers,
              data: data.length > 0 ? data : undefined,
            });
          }}
          isLoading={sendMutation.isPending}
        />
      )}
    </div>
  );
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
          className="w-[180px] justify-between"
        >
          {`${value} (${getCountryCallingCode(value)})`}
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
                    value={[country, callingCode].join(",")}
                    onSelect={(currentValue) => {
                      const [currentCountry] = currentValue.split(",");
                      onValueChange(currentCountry as CountryCode);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === country ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {`${country} (${callingCode})`}
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

function TemplateForm({
  fileData,
  setFileData,
  message,
  setMessage,
  defaultCountry,
  setDefaultCountry,
  hasHeaders,
  setHasHeaders,
  selectedPhoneColumn,
  setSelectedPhoneColumn,
  onSubmit,
  isLoading,
}: {
  fileData: FileData | null;
  setFileData: React.Dispatch<React.SetStateAction<FileData | null>>;
  message: (string | number)[];
  setMessage: React.Dispatch<React.SetStateAction<(string | number)[]>>;
  defaultCountry: CountryCode;
  setDefaultCountry: React.Dispatch<React.SetStateAction<CountryCode>>;
  hasHeaders: boolean;
  setHasHeaders: React.Dispatch<React.SetStateAction<boolean>>;
  selectedPhoneColumn: number | null;
  setSelectedPhoneColumn: React.Dispatch<React.SetStateAction<number | null>>;
  onSubmit: (validRows: string[][]) => void;
  isLoading: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [rawRows, setRawRows] = useState<string[][]>([]);

  function clearForm() {
    setFileData(null);
    setMessage([]);
    setSelectedPhoneColumn(null);
    setRawRows([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function updateFileData(rows: string[][], hasHeaders: boolean) {
    // Find the maximum number of columns in any row
    const maxColumns = Math.max(...rows.map((row) => row.length));

    // Generate headers for all columns
    const headers = Array.from({ length: maxColumns }, (_, index) => {
      const header = hasHeaders ? rows[0]?.[index] : null;
      return header?.trim() || `column_${index + 1}`;
    });

    // If hasHeaders is true, use rows after the first row as data
    // If hasHeaders is false, use all rows as data
    const dataRows = hasHeaders && rows.length ? rows.slice(1) : rows;

    setFileData({
      headers,
      rows: dataRows,
      selectedColumns: [],
    });
    setSelectedPhoneColumn(null);
  }

  // Filter rows based on valid phone numbers and remove duplicates
  function filterValidPhoneNumbers(rows: string[][], phoneColumn: number) {
    const seen = new Map<string, number>();
    const validRows = rows.filter((row) => {
      const phoneNumber = parsePhoneNumberFromString(
        String(row[phoneColumn]),
        defaultCountry
      );
      return phoneNumber?.isValid() ?? false;
    });

    // Keep track of the latest occurrence of each phone number
    validRows.forEach((row, index) => {
      const phoneNumber = parsePhoneNumberFromString(
        String(row[phoneColumn]),
        defaultCountry
      );
      if (phoneNumber) {
        seen.set(phoneNumber.number, index);
      }
    });

    // Filter to keep only the latest occurrence of each phone number
    return validRows.filter((row, index) => {
      const phoneNumber = parsePhoneNumberFromString(
        String(row[phoneColumn]),
        defaultCountry
      );
      return phoneNumber && seen.get(phoneNumber.number) === index;
    });
  }

  // Get valid rows when needed
  const validRows = useMemo(() => {
    if (!fileData || selectedPhoneColumn === null) return [];
    return filterValidPhoneNumbers(fileData.rows, selectedPhoneColumn);
  }, [fileData, selectedPhoneColumn, defaultCountry]);

  // Show warnings when phone column changes
  useEffect(() => {
    if (fileData && selectedPhoneColumn !== null) {
      const invalidCount = fileData.rows.length - validRows.length;
      const duplicateCount =
        fileData.rows.length -
        new Set(
          fileData.rows
            .map((row) => {
              const phoneNumber = parsePhoneNumberFromString(
                String(row[selectedPhoneColumn]),
                defaultCountry
              );
              return phoneNumber?.number;
            })
            .filter(Boolean)
        ).size;

      if (validRows.length === 0) {
        toast.error("No valid phone numbers found in the selected column");
        return;
      }
      if (invalidCount > 0) {
        toast.warning(`${invalidCount} rows have invalid phone numbers`);
      }
      if (duplicateCount > 0) {
        toast.info(
          `${duplicateCount} duplicate phone numbers were found, keeping the latest occurrence`
        );
      }
    }
  }, [selectedPhoneColumn]); // Only run when phone column changes

  // Update file data when hasHeaders changes
  useEffect(() => {
    if (rawRows.length > 0) {
      updateFileData(rawRows, hasHeaders);
    }
  }, [hasHeaders]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target!.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];

      if (rows.length === 0) {
        toast.error("File is empty");
        return;
      }

      setRawRows(rows);
      updateFileData(rows, hasHeaders);
    };
    reader.readAsArrayBuffer(file);
  }

  return (
    <div className="container mx-auto p-8">
      <Card className="max-w-2xl mx-auto mb-8">
        <CardContent className="pt-6 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold">Send Template Messages</h2>
            {fileData && (
              <Button variant="outline" size="sm" onClick={clearForm}>
                Clear Form
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <Label htmlFor="country">Country:</Label>
              <CountrySelector
                value={defaultCountry}
                onValueChange={setDefaultCountry}
              />
            </div>

            <div className="flex items-center gap-4">
              <Label htmlFor="headers">First row is headers:</Label>
              <Switch
                id="headers"
                checked={hasHeaders}
                onCheckedChange={setHasHeaders}
              />
            </div>

            <div className="flex gap-2 items-center">
              <Input
                type="file"
                accept=".csv,.xlsx,.xls"
                ref={fileInputRef}
                onChange={handleFile}
              />
            </div>
          </div>

          {fileData && (
            <>
              <div className="flex flex-col gap-2">
                <Label>Select Phone Number Column:</Label>
                <Select
                  required
                  value={selectedPhoneColumn?.toString() || ""}
                  onValueChange={(value) =>
                    setSelectedPhoneColumn(Number(value))
                  }
                >
                  <SelectTrigger
                    className={
                      selectedPhoneColumn === undefined ||
                      selectedPhoneColumn === null
                        ? "border-destructive"
                        : ""
                    }
                  >
                    <SelectValue placeholder="Select column" />
                  </SelectTrigger>
                  <SelectContent>
                    {fileData.headers.map((header, index) => (
                      <SelectItem key={index} value={index.toString()}>
                        {header}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedPhoneColumn !== null && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label>Phone Numbers:</Label>
                    <span className="text-sm text-muted-foreground">
                      Valid: {validRows.length} / Total: {fileData.rows.length}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 max-h-[200px] overflow-y-auto p-2 border rounded">
                    {validRows.map((row, i) => {
                      const phoneNumber = parsePhoneNumberFromString(
                        String(row[selectedPhoneColumn]),
                        defaultCountry
                      );
                      return (
                        <Badge
                          key={i}
                          variant="secondary"
                          className="cursor-default select-none"
                          title="Valid number"
                        >
                          {phoneNumber?.formatInternational()}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label>Message Template:</Label>
                <MessageEditor
                  columns={fileData.headers.map((name, index) => ({
                    index,
                    name,
                  }))}
                  value={message}
                  onChange={(newMessage) => {
                    // Update selectedColumns based on the new message
                    const columns = new Set<number>();
                    newMessage.forEach((part) => {
                      if (typeof part === "number") {
                        columns.add(part);
                      }
                    });
                    setFileData((prev) => ({
                      ...prev!,
                      selectedColumns: Array.from(columns),
                    }));
                    setMessage(newMessage);
                  }}
                />
                <p className="text-sm text-muted-foreground mt-1">
                  Type @ to insert a column value. The column value will be
                  replaced with the actual data for each recipient.
                </p>
              </div>

              <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    disabled={
                      !fileData ||
                      selectedPhoneColumn === null ||
                      message.length === 0 ||
                      isLoading ||
                      validRows.length === 0
                    }
                    onClick={() => setShowConfirm(true)}
                  >
                    Send Bulk Messages
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Confirm Send</AlertDialogTitle>
                    <AlertDialogDescription>
                      You are about to send <b>{validRows.length}</b> messages.
                      <br />
                      <span className="block mt-2 mb-1 font-semibold">
                        Message template:
                      </span>
                      <span className="block p-2 border rounded bg-gray-50 text-sm whitespace-pre-line">
                        {message.map((part, index) => (
                          <span key={index}>
                            {typeof part === "number" ? (
                              <Badge variant="outline" className="mx-1">
                                {fileData.headers[part]}
                              </Badge>
                            ) : (
                              part
                            )}
                          </span>
                        ))}
                      </span>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        setShowConfirm(false);
                        onSubmit(validRows);
                      }}
                    >
                      Send
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SubmissionProgress({
  progress,
  onNewSubmission,
}: {
  progress: any;
  onNewSubmission: () => void;
}) {
  const total = progress?.results?.length || 0;
  const sent =
    progress?.results?.filter(
      (r: any) => r.status === "SENT" || r.status === "FAILED"
    ).length || 0;
  const percent =
    progress?.results && progress.results.length > 0
      ? Math.round((sent / progress.results.length) * 100)
      : 0;

  return (
    <Card className="max-w-2xl mx-auto">
      <CardContent className="pt-6">
        <h3 className="text-lg font-bold mb-2">Progress</h3>
        <Progress value={percent} className="mb-4" />
        <div className="mb-2 text-xs text-muted-foreground">
          {sent} of {total} processed ({percent}%)
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Number</th>
              <th className="text-left">Status</th>
              <th className="text-left">Error</th>
            </tr>
          </thead>
          <tbody>
            {progress?.results?.map((r: any, i: number) => (
              <tr key={i}>
                <td>{r.number}</td>
                <td>{r.status}</td>
                <td>{r.error || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 text-xs text-muted-foreground">
          Status: {progress?.status}
        </div>
        <Button className="mt-4" type="button" onClick={onNewSubmission}>
          New Submission
        </Button>
      </CardContent>
    </Card>
  );
}
