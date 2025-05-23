import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import * as XLSX from "xlsx";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
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
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/bulk")({
  component: Bulk,
});

export function Bulk() {
  const router = useRouter();
  const { data: loggedIn, isLoading: loginLoading } = useQuery(
    trpc.checkLogin.queryOptions()
  );
  const [numbers, setNumbers] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [submitId, setSubmitId] = useState<string | null>(null);

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

  // Common function to add numbers, validate, and handle invalid numbers
  const addNumbersToList = (rawNumbers: string[]) => {
    const { validNumbers, invalidNumbers } = validateNumbers(rawNumbers);

    if (invalidNumbers.length > 0) {
      toast.error(`Invalid numbers:\n${invalidNumbers.join(", ")}`, {
        duration: 6000,
      });
    }

    // Add only unique valid numbers to the existing list
    setNumbers((prev) => Array.from(new Set([...prev, ...validNumbers])));
  };

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
            setNumbers([]);
            setMessage("");
          }}
        />
      ) : (
        <SubmissionForm
          numbers={numbers}
          setNumbers={setNumbers}
          message={message}
          setMessage={setMessage}
          onSubmit={() => sendMutation.mutate({ numbers, message })}
          isLoading={sendMutation.isPending}
          addNumbersToList={addNumbersToList}
        />
      )}
    </div>
  );
}

function parseContactsFromFile(
  file: File,
  defaultCountry: CountryCode = "BH"
): Promise<string[]> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target!.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
      const flatNumbers = rows
        .flat()
        .filter(Boolean)
        .map((value) => String(value));
      resolve(flatNumbers);
    };
    reader.readAsArrayBuffer(file);
  });
}

function validateNumbers(
  numbers: string[],
  defaultCountry: CountryCode = "BH"
) {
  const uniqueNumbers = Array.from(new Set(numbers));
  const validNumbers: string[] = [];
  const invalidNumbers: string[] = [];

  for (const n of uniqueNumbers) {
    const phoneNumber = parsePhoneNumberFromString(n, defaultCountry);
    if (phoneNumber && phoneNumber.isValid()) {
      validNumbers.push(phoneNumber.number.replace("+", ""));
    } else {
      invalidNumbers.push(n);
    }
  }
  return { validNumbers, invalidNumbers };
}

function SubmissionForm({
  numbers,
  setNumbers,
  message,
  setMessage,
  onSubmit,
  isLoading,
  addNumbersToList,
}: {
  numbers: string[];
  setNumbers: React.Dispatch<React.SetStateAction<string[]>>;
  message: string;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  onSubmit: () => void;
  isLoading: boolean;
  addNumbersToList: (rawNumbers: string[]) => void;
}) {
  const [manualInput, setManualInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      const numbers = await parseContactsFromFile(file);
      addNumbersToList(numbers);
    }
  }

  function handleClipboard() {
    navigator.clipboard.readText().then((text) => {
      const numbers = text
        .split(/,|;|\n/)
        .map((n) => n.trim())
        .filter(Boolean);
      addNumbersToList(numbers);
    });
  }

  function handleManualAdd() {
    const numbers = manualInput
      .split(/,|;|\n/)
      .map((n) => n.trim())
      .filter(Boolean);
    addNumbersToList(numbers);
    setManualInput("");
  }

  return (
    <div className="container mx-auto p-8">
      <Card className="max-w-2xl mx-auto mb-8">
        <CardContent className="pt-6 flex flex-col gap-4">
          <h2 className="text-2xl font-bold mb-2">
            Send Bulk WhatsApp Messages
          </h2>
          <div className="flex gap-2 items-center">
            <Input
              type="file"
              accept=".csv,.xlsx,.xls"
              ref={fileInputRef}
              onChange={handleFile}
            />
          </div>
          <div className="flex items-center justify-center my-2">
            <div className="flex-1 border-t border-muted-foreground" />
            <span className="mx-4 text-muted-foreground text-xs">Or</span>
            <div className="flex-1 border-t border-muted-foreground" />
          </div>
          <div className="flex gap-2 justify-center">
            <Button type="button" onClick={handleClipboard}>
              Paste from Clipboard
            </Button>
          </div>
          <div className="flex items-center justify-center my-2">
            <div className="flex-1 border-t border-muted-foreground" />
            <span className="mx-4 text-muted-foreground text-xs">Or</span>
            <div className="flex-1 border-t border-muted-foreground" />
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Add numbers manually (comma, separated)"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
            />
            <Button type="button" onClick={handleManualAdd}>
              <Plus />
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {numbers.map((n, i) => (
              <Badge
                key={i}
                className="cursor-pointer select-none"
                onClick={() =>
                  setNumbers(numbers.filter((num, idx) => idx !== i))
                }
                variant="secondary"
                title="Click to remove"
              >
                {n}
              </Badge>
            ))}
          </div>

          <div className="flex items-center justify-between my-2">
            <span className="text-sm text-muted-foreground">
              Total numbers: {numbers.length}
            </span>
            <Button
              type="button"
              variant="destructive"
              onClick={() => setNumbers([])}
              disabled={numbers.length == 0}
            >
              Clear numbers
            </Button>
          </div>
          <div className="flex items-center justify-center my-4">
            <div className="flex-1 border-t border-muted-foreground" />
          </div>
          <Textarea
            placeholder="Type your message here"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                disabled={numbers.length === 0 || !message || isLoading}
                onClick={() => setShowConfirm(true)}
              >
                Send Bulk Message
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Send</AlertDialogTitle>
                <AlertDialogDescription>
                  You are about to send <b>{numbers.length}</b> messages.
                  <br />
                  <span className="block mt-2 mb-1 font-semibold">
                    Message preview:
                  </span>
                  <span className="block p-2 border rounded bg-gray-50 text-sm whitespace-pre-line">
                    {message}
                  </span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setShowConfirm(false);
                    onSubmit();
                  }}
                >
                  Send
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
  // Calculate progress percentage
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
        {/* Progress Bar */}
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
