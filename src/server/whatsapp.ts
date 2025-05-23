import { Client, LocalAuth } from "whatsapp-web.js";
import qrcode from "qrcode";
import { randomUUID } from "crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js";

type BulkJob = {
  numbers: string[];
  message: string;
  results: { number: string; status: string; error?: string }[];
  status: "PENDING" | "IN_PROGRESS" | "DONE";
};

class WhatsAppService {
  client: Client;
  isReady: boolean = false;
  qr: string | null = null;
  jobs: Map<string, BulkJob> = new Map();
  loggedIn: boolean = false;

  constructor() {
    this.initClient();
  }

  private initClient() {
    console.log("initClient");
    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        // ignoreDefaultArgs: ["--enable-automation", "--disable-dev-shm-usage"],
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
    });

    this.client.on("qr", (qr) => {
      this.qr = qr;
      console.log("qr");
    });

    this.client.on("ready", () => {
      this.isReady = true;
      this.qr = null;
      console.log("ready");
    });

    this.client.on("authenticated", () => {
      this.loggedIn = true;
      this.qr = null;
      console.log("authenticated");
    });

    this.client.on("auth_failure", () => {
      this.loggedIn = false;
      console.log("auth_failure");
    });

    this.client.on("disconnected", () => {
      this.isReady = false;
      this.loggedIn = false;
      console.log("disconnected");
    });

    this.client.on("change_state", (state) => {
      // Optionally, you can log or use this for more granularity
      // console.log("Client state changed:", state);
      console.log("change_state", state);
    });

    this.client.initialize();
  }

  async getQrCodeImage() {
    if (!this.qr) return null;
    return await qrcode.toDataURL(this.qr);
  }

  isLoggedIn() {
    return this.loggedIn && this.isReady;
  }

  startBulkJob(numbers: string[], message: string) {
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
            await this.client.sendMessage(number + "@c.us", job.message);
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
    await this.client.logout();
    this.isReady = false;
    this.loggedIn = false;
    this.qr = null;
    this.jobs.clear();
    this.initClient();
  }

  async getContactInfo() {
    if (!this.isLoggedIn()) return null;
    try {
      const me = await this.client.info;
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
