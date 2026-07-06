import { createRequire } from "node:module";
import { generateProductionPlan } from "./plannerService.js";

const require = createRequire(import.meta.url);

const qrcode = require("qrcode-terminal") as {
  generate: (qr: string, options?: { small?: boolean }) => void;
};

const whatsappWeb = require("whatsapp-web.js") as typeof import("whatsapp-web.js");

const { Client, LocalAuth } = whatsappWeb;

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "production-planner-demo",
  }),
  puppeteer: {
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", (qr: string) => {
  console.log("");
  console.log("Scan this QR code with WhatsApp:");
  console.log("WhatsApp phone app → Linked devices → Link a device");
  console.log("");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("[whatsappBot] WhatsApp QR demo bot is ready.");
  console.log("[whatsappBot] Send 'ping' to test replies.");
  console.log("[whatsappBot] Send 'plan: your project description' to generate a production plan.");
});

client.on("authenticated", () => {
  console.log("[whatsappBot] WhatsApp session authenticated.");
});

client.on("auth_failure", (message: string) => {
  console.error("[whatsappBot] Authentication failed:", message);
});

client.on("message", async (message) => {
  if (message.fromMe) {
    return;
  }

  const text = message.body.trim();

  console.log("[whatsappBot] Message received:", text);

  if (text.toLowerCase() === "ping") {
    await message.reply(
      "Production Planner WhatsApp demo bot is connected. Send a message starting with 'plan:' to generate a production plan.",
    );
    return;
  }

  if (text.toLowerCase().startsWith("plan:")) {
    const projectDescription = text.slice("plan:".length).trim();

    if (!projectDescription) {
      await message.reply(
        "Please include your project description after 'plan:'. Example:\n\nplan: Create a 1-week production plan for a student enrollment encoding project with 8 total hours.",
      );
      return;
    }

    await message.reply(
      "Got it. I am generating your production plan now. This may take a moment because Ollama needs to create the plan and Excel workbook.",
    );

    try {
      const result = await generateProductionPlan({
        whatsappUserId: message.from,
        workbookMode: "dynamic",
        projectDescription,
      });

      if (!result.success) {
        await message.reply(result.whatsappSummary);
        return;
      }

      const downloadLine = result.workbookSignedUrl
        ? `\n\nDownload Excel workbook:\n${result.workbookSignedUrl}\n\nThis link expires in ${result.workbookSignedUrlExpiresInSeconds ?? 3600} seconds.`
        : "\n\nExcel workbook was created, but no signed download link was returned.";

      await message.reply(`${result.whatsappSummary}${downloadLine}`);
      return;
    } catch (error) {
      console.error("[whatsappBot] Planner generation failed:", error);
      await message.reply(
        `Production plan generation failed.\n\nError: ${(error as Error).message}`,
      );
      return;
    }
  }

  await message.reply(
    "Demo bot received your message. Send 'ping' to test, or start a production plan request with 'plan:'.",
  );
});

client.initialize().catch((error: unknown) => {
  console.error("[whatsappBot] Failed to initialize:", error);
  process.exitCode = 1;
});
