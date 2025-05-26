import { createBunHttpHandler } from "trpc-bun-adapter";
import type { CreateBunContextOptions } from "trpc-bun-adapter";
import { publicProcedure, router } from "./trpc";
import { whatsappService } from "./whatsapp";
import { z } from "zod/v4";

const appRouter = router({
  getQrCode: publicProcedure.query(async () => {
    return (await whatsappService.getQrCodeImage()) as string;
  }),
  checkLogin: publicProcedure.query(() => {
    return whatsappService.isLoggedIn();
  }),
  sendBulkMessages: publicProcedure
    .input(
      z.object({
        message: z.array(z.union([z.string(), z.number()])),
        numbers: z.array(z.string()),
        data: z.array(z.array(z.string().nullable())).optional(),
      })
    )
    .mutation(async ({ input }) => {
      return {
        submitId: await whatsappService.startBulkJob(
          input.numbers,
          input.message,
          input.data
        ),
      };
    }),
  getBulkProgress: publicProcedure
    .input(z.object({ submitId: z.string() }))
    .query(({ input }) => {
      return whatsappService.getBulkProgress(input.submitId);
    }),
  logout: publicProcedure.mutation(async () => {
    await whatsappService.logout();
    return true;
  }),
  getContactInfo: publicProcedure.query(async () => {
    return await whatsappService.getContactInfo();
  }),
});

const createContext = (opts: CreateBunContextOptions) => ({
  user: 1,
});

export const trpcHandler = createBunHttpHandler({
  router: appRouter,
  endpoint: "/trpc",
  onError: console.error,
  createContext,
  responseMeta(opts) {
    return {
      status: 202,
      headers: {},
    };
  },
  batching: {
    enabled: true,
  },
  emitWsUpgrades: false,
});

// Export type router type signature,
// NOT the router itself.
export type AppRouter = typeof appRouter;
