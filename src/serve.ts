import { serve, type Server } from "bun";
import index from "@/index.html";
import { trpcHandler } from "@/server";
import { whatsappService } from "@/server/whatsapp";

const server = serve({
  hostname: "0.0.0.0", // Bind to all interfaces
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/health": new Response("OK"),

    "/trpc/*": async (request: Request, server: Server) => {
      return (
        trpcHandler(request, server) ??
        new Response("Not found", { status: 404 })
      );
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

// Handle process signals
process.on("SIGTERM", async () => {
  console.log("Received SIGTERM. Shutting down gracefully...");
  await server.stop();
  await whatsappService.logout();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("Received SIGINT. Shutting down gracefully...");
  await server.stop();
  await whatsappService.logout();
  process.exit(0);
});

console.log(`🚀 Server running at ${server.url}`);
console.log("Server configuration:", {
  hostname: server.hostname,
  port: server.port,
  development: process.env.NODE_ENV !== "production",
});
