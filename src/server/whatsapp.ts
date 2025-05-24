import { Client, LocalAuth } from "whatsapp-web.js";
import qrcode from "qrcode";
import { randomUUID } from "crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import humanizeDuration from "humanize-duration";

type BulkJob = {
  numbers: string[];
  message: string;
  results: { number: string; status: string; error?: string }[];
  status: "PENDING" | "IN_PROGRESS" | "DONE";
};

const WHATSAPP_INACTIVITY_TIMEOUT = Number(
  process.env.BUN_PUBLIC_WHATSAPP_INACTIVITY_TIMEOUT
);

class WhatsAppClientWrapper {
  private client: Client | null = null;
  private inactivityTimeout: NodeJS.Timeout | null = null;
  private readonly INACTIVITY_TIMEOUT =
    Number(WHATSAPP_INACTIVITY_TIMEOUT) || 30 * 60 * 1000; // 30 minutes default
  private isReady: boolean = false;
  private qr: string | null = null;
  private loggedIn: boolean = false;
  private eventHandlers: Map<string, (...args: any[]) => void> = new Map();
  private isShuttingDown: boolean = false;
  private isInitClient: boolean = false;

  constructor() {
    console.log(
      `WhatsApp client inactivity timeout set to ${humanizeDuration(this.INACTIVITY_TIMEOUT)}`
    );
  }

  private initClient() {
    console.time("WhatsAppClientWrapper#initClient");
    console.time("WhatsApp client initilized");

    if (this.isInitClient) return;
    this.isInitClient = true;

    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        // ignoreDefaultArgs: ["--enable-automation", "--disable-dev-shm-usage"],
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
    });

    // Store event handlers for cleanup
    const handlers = {
      qr: (qr: string) => {
        this.qr = qr;
        console.timeEnd("WhatsApp client initilized");
        console.log("WhatsAppClientWrapper#client.on(qr)");
      },
      ready: () => {
        this.isReady = true;
        this.qr = null;
        console.timeEnd("WhatsApp client initilized");
        console.log("WhatsAppClientWrapper#client.on(ready)");
      },
      authenticated: () => {
        this.loggedIn = true;
        this.qr = null;
        console.log("WhatsAppClientWrapper#client.on(authenticated)");
      },
      auth_failure: () => {
        this.loggedIn = false;
        console.log("WhatsAppClientWrapper#client.on(auth_failure)");
      },
      disconnected: () => {
        this.isReady = false;
        this.loggedIn = false;
        console.log("WhatsAppClientWrapper#client.on(disconnected)");
      },
      change_state: (state: string) => {
        console.log(`WhatsAppClientWrapper#client.on(change_state,${state})`);
      },
    };

    // Register event handlers
    Object.entries(handlers).forEach(([event, handler]) => {
      this.client!.on(event, handler);
      this.eventHandlers.set(event, handler);
    });

    console.log("Client listeners", this.client.eventNames());

    this.client.initialize();
    this.isInitClient = false;
  }

  private resetInactivityTimer() {
    // Don't set new timeout if we're shutting down
    if (this.isShuttingDown) return;

    if (this.inactivityTimeout) {
      // reschedules the timer
      this.inactivityTimeout.refresh();
    } else {
      // Set new timeout
      this.inactivityTimeout = setTimeout(() => {
        console.log("Inactivity timeout reached, shutting down client...");
        this.shutdown();
      }, this.INACTIVITY_TIMEOUT);
    }
  }

  private removeEventListeners() {
    if (this.client) {
      this.eventHandlers.forEach((handler, event) => {
        this.client!.removeListener(event, handler);
      });
      this.eventHandlers.clear();
    }
  }

  async shutdown() {
    console.time("WhatsAppClientWrapper#shutdown");
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    try {
      // Clear inactivity timeout
      if (this.inactivityTimeout) {
        this.inactivityTimeout.close();
        clearTimeout(this.inactivityTimeout);
        this.inactivityTimeout = null;
      }

      // Remove event listeners
      this.removeEventListeners();

      // Destroy client if it exists
      if (this.client) {
        await this.client.destroy();
      }
    } catch (error) {
      console.error("Error during shutdown:", error);
    } finally {
      // Clear all references
      this.isShuttingDown = false;
      this.isReady = false;
      this.qr = null;
      this.client = null;
      this.loggedIn = false;
    }
    console.timeEnd("WhatsAppClientWrapper#shutdown");
  }

  async destroy() {
    console.log("WhatsAppClientWrapper#destroy");
    await this.shutdown();
  }

  async getClient(): Promise<Client> {
    if (!this.client) {
      this.initClient();
    }
    this.resetInactivityTimer();
    return this.client!;
  }

  getState() {
    this.getClient();
    return {
      isReady: this.isReady,
      qr: this.qr,
      loggedIn: this.loggedIn,
    };
  }
}

class WhatsAppService {
  jobs: Map<string, BulkJob> = new Map();
  private wrapper: WhatsAppClientWrapper;

  constructor() {
    this.wrapper = new WhatsAppClientWrapper();
  }

  async getQrCodeImage() {
    const { qr } = this.wrapper.getState();
    if (!qr) return null;
    return await qrcode.toDataURL(qr);
  }

  isLoggedIn() {
    const { loggedIn, isReady } = this.wrapper.getState();
    return loggedIn && isReady;
  }

  async startBulkJob(numbers: string[], message: string) {
    const client = await this.wrapper.getClient();
    // Ensure numbers are unique and valid using libphonenumber-js
    const uniqueNumbers = Array.from(new Set(numbers));
    const validNumbers: string[] = [];
    const invalidNumbers: string[] = [];

    for (const n of uniqueNumbers) {
      const phoneNumber = parsePhoneNumberFromString(n, "BH");
      if (phoneNumber && phoneNumber.isValid()) {
        // Use E.164 format for WhatsApp
        validNumbers.push(phoneNumber.number.replace("+", ""));
      } else {
        invalidNumbers.push(n);
      }
    }

    const submitId = randomUUID();
    const job: BulkJob = {
      numbers: uniqueNumbers,
      message,
      results: [],
      status: "PENDING",
    };
    this.jobs.set(submitId, job);

    // Prevent sending if not logged in
    if (!this.isLoggedIn()) {
      job.status = "DONE";
      for (const number of validNumbers) {
        job.results.push({
          number,
          status: "FAILED",
          error: "Not logged in to WhatsApp",
        });
      }
      return submitId;
    }

    // Mark invalid numbers as failed
    for (const number of invalidNumbers) {
      job.results.push({
        number,
        status: "FAILED",
        error: "Invalid number format",
      });
    }

    // If there are any invalid numbers, stop and do not send to any
    if (invalidNumbers.length > 0) {
      job.status = "DONE";
      return submitId;
    }

    // Only send to valid numbers
    this._sendBulk(submitId, job, validNumbers);
    return submitId;
  }

  private async _sendBulk(
    submitId: string,
    job: BulkJob,
    validNumbers: string[]
  ) {
    const client = await this.wrapper.getClient();
    job.status = "IN_PROGRESS";
    if (!this.isLoggedIn()) {
      for (const number of validNumbers) {
        job.results.push({
          number,
          status: "FAILED",
          error: "Not logged in to WhatsApp",
        });
      }
      job.status = "DONE";
      return;
    }
    // Batch sending logic
    const batchSize = 10; // Number of messages per batch
    const batchDelay = 2000; // Delay between batches in ms (2 seconds)
    for (let i = 0; i < validNumbers.length; i += batchSize) {
      const batch = validNumbers.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (number) => {
          try {
            await client.sendMessage(number + "@c.us", job.message);
            job.results.push({ number, status: "SENT" });
          } catch (e) {
            job.results.push({ number, status: "FAILED", error: e.message });
          }
        })
      );
      if (i + batchSize < validNumbers.length) {
        await new Promise((res) => setTimeout(res, batchDelay));
      }
    }
    job.status = "DONE";
  }

  getBulkProgress(submitId: string) {
    return this.jobs.get(submitId) || null;
  }

  async logout() {
    console.log("WhatsAppService#logout");
    const client = await this.wrapper.getClient();
    await client.logout();
    await this.wrapper.destroy();
    this.jobs.clear();
  }

  async close() {
    await this.wrapper.destroy();
    this.jobs.clear();
  }

  async getContactInfo() {
    const client = await this.wrapper.getClient();
    if (!this.isLoggedIn()) return null;
    try {
      const me = await client.info;
      return {
        name: me.pushname || me.wid.user || "Unknown",
        number: me.wid.user,
      };
    } catch {
      return null;
    }
  }
}

export const whatsappService = new WhatsAppService();
