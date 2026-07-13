import { createRequire } from "node:module";
import { generateProductionPlan } from "./plannerService.js";
import {
  getSimpleMathReply,
  getSocialReply,
  normalizeBotMessageText,
  parseProductionPlanCommand,
  productionPlanCommandExample,
  productionPlanCommandHelp,
} from "./services/whatsappCommandService.js";
import {
  isAllowedWhatsAppGroup,
  maskWhatsAppGroupId,
  normalizeGroupAccessConfig,
  type ChatIdentity,
  type GroupAccessConfig,
} from "./services/whatsappAccessService.js";

const require = createRequire(import.meta.url);

const qrcode = require("qrcode-terminal") as {
  generate: (qr: string, options?: { small?: boolean }) => void;
};

const whatsappWeb = require("whatsapp-web.js") as typeof import("whatsapp-web.js");

const { Client, LocalAuth, MessageMedia } = whatsappWeb;

const groupAccessConfig: GroupAccessConfig = normalizeGroupAccessConfig({
  allowedGroupId: process.env.WHATSAPP_ALLOWED_GROUP_ID ?? "",
  allowedGroupName: process.env.WHATSAPP_ALLOWED_GROUP_NAME ?? "test bot",
});
const logFullGroupId = (process.env.WHATSAPP_LOG_FULL_GROUP_ID ?? "").trim() === "1";
const productionWorkbookFilename = "ProductionPlan.xlsx";
const whatsAppClientId = "production-planner-demo";
const chromeExecutablePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const readyWarningTimeoutMs = 90_000;
let readyWarningTimer: NodeJS.Timeout | undefined;
let puppeteerDiagnosticsAttached = false;

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: whatsAppClientId,
  }),
  puppeteer: {
    executablePath: chromeExecutablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

function logAccessMode(): void {
  if (groupAccessConfig.allowedGroupId) {
    console.log(
      `[whatsappBot] Group access is limited to configured group ID: ${maskWhatsAppGroupId(groupAccessConfig.allowedGroupId)}`,
    );
    return;
  }

  console.warn(
    `[whatsappBot] WHATSAPP_ALLOWED_GROUP_ID is not configured. Temporarily using group name fallback: "${groupAccessConfig.allowedGroupName}"`,
  );
}

function logApprovedFallbackGroup(chat: ChatIdentity): void {
  if (groupAccessConfig.allowedGroupId) {
    return;
  }

  const displayId = logFullGroupId ? chat.id : maskWhatsAppGroupId(chat.id);
  console.log(`[whatsappBot] Group detected: name="${chat.name}", id="${displayId}"`);

  if (!logFullGroupId) {
    console.log(
      "[whatsappBot] To print the complete group ID locally, restart with WHATSAPP_LOG_FULL_GROUP_ID=1, then copy that value into WHATSAPP_ALLOWED_GROUP_ID.",
    );
  }
}

function attachPuppeteerDiagnostics(): void {
  if (puppeteerDiagnosticsAttached || (!client.pupPage && !client.pupBrowser)) {
    return;
  }

  puppeteerDiagnosticsAttached = true;

  client.pupPage?.on("pageerror", (error: unknown) => {
    console.error("[whatsappBot] WhatsApp Web page error:", error instanceof Error ? error.message : String(error));
  });

  client.pupPage?.on("error", (error: unknown) => {
    console.error("[whatsappBot] Puppeteer page crashed:", error instanceof Error ? error.message : String(error));
  });

  client.pupBrowser?.on("disconnected", () => {
    console.error("[whatsappBot] Puppeteer browser disconnected.");
  });
}

function startReadyWarningTimer(): void {
  readyWarningTimer = setTimeout(() => {
    console.warn(
      `[whatsappBot] Still waiting for ready after ${readyWarningTimeoutMs / 1000}s. If authentication already succeeded, check for a stale LocalAuth session, another bot using clientId "${whatsAppClientId}", or a WhatsApp Web/Puppeteer loading failure.`,
    );
  }, readyWarningTimeoutMs);
}

function clearReadyWarningTimer(): void {
  if (readyWarningTimer) {
    clearTimeout(readyWarningTimer);
    readyWarningTimer = undefined;
  }
}

console.log("[whatsappBot] Starting WhatsApp QR demo bot.");
console.log(`[whatsappBot] LocalAuth clientId: ${whatsAppClientId}`);
console.log(`[whatsappBot] Chrome executable: ${chromeExecutablePath}`);
logAccessMode();
startReadyWarningTimer();

client.on("qr", (qr: string) => {
  console.log("");
  console.log("Scan this QR code with WhatsApp:");
  console.log("WhatsApp phone app → Linked devices → Link a device");
  console.log("");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  clearReadyWarningTimer();
  attachPuppeteerDiagnostics();
  console.log("[whatsappBot] WhatsApp QR demo bot is ready.");
  console.log("[whatsappBot] Send 'ping' to test replies.");
  console.log(`[whatsappBot] ${productionPlanCommandHelp}`);
  logAccessMode();
});

client.on("authenticated", () => {
  console.log("[whatsappBot] WhatsApp session authenticated.");
  attachPuppeteerDiagnostics();
});

client.on("auth_failure", (message: string) => {
  console.error("[whatsappBot] Authentication failed:", message);
});

client.on("loading_screen", (percent: string, message: string) => {
  console.log(`[whatsappBot] Loading WhatsApp Web: ${percent}% ${message}`);
  attachPuppeteerDiagnostics();
});

client.on("change_state", (state: string) => {
  console.log(`[whatsappBot] WhatsApp client state changed: ${state}`);
});

client.on("disconnected", (reason: string) => {
  clearReadyWarningTimer();
  console.error("[whatsappBot] WhatsApp client disconnected:", reason);
});

client.on("message", async (message) => {
  if (message.fromMe) {
    return;
  }

  const chat = await message.getChat();
  const chatIdentity: ChatIdentity = {
    isGroup: chat.isGroup,
    id: chat.id._serialized,
    name: chat.name,
  };

  if (!isAllowedWhatsAppGroup(chatIdentity, groupAccessConfig)) {
    console.log(
      `[whatsappBot] Ignored message outside allowed group. isGroup=${chatIdentity.isGroup}, chatId=${maskWhatsAppGroupId(chatIdentity.id)}, chatName="${chatIdentity.isGroup ? chatIdentity.name : "private chat"}"`,
    );
    return;
  }

  logApprovedFallbackGroup(chatIdentity);

  const text = message.body.trim();
  const normalizedText = normalizeBotMessageText(text);

  console.log("[whatsappBot] Authorized message received.");

  if (normalizedText.toLowerCase() === "ping") {
    await message.reply(
      `Production Planner WhatsApp demo bot is connected. ${productionPlanCommandHelp}`,
    );
    return;
  }

  const socialReply = getSocialReply(text);
  if (socialReply) {
    await message.reply(socialReply);
    return;
  }

  const mathReply = getSimpleMathReply(text);
  if (mathReply) {
    await message.reply(mathReply);
    return;
  }

  const command = parseProductionPlanCommand(text);
  if (command) {
    const { projectDescription } = command;

    if (!projectDescription) {
      await message.reply(
        `Please include your project description after the command. Example:\n\n${productionPlanCommandExample}`,
      );
      return;
    }

    await message.reply(
      "Got it. I'm generating your production plan now...",
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

      const dateLine = result.dateInterpretations?.length
        ? `${result.dateInterpretations.join("\n")}\n\n`
        : "";

      await message.reply(`${dateLine}${result.whatsappSummary}\n\nI'm sending the Excel workbook as a document file now.`);

      if (!result.workbookPath) {
        await message.reply("The production plan was generated, but I could not find the Excel workbook file to attach.");
        return;
      }

      const workbookMedia = MessageMedia.fromFilePath(result.workbookPath);
      workbookMedia.filename = productionWorkbookFilename;
      workbookMedia.mimetype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

      await chat.sendMessage(workbookMedia, {
        caption: productionWorkbookFilename,
        quotedMessageId: message.id._serialized,
        sendMediaAsDocument: true,
        waitUntilMsgSent: true,
      });
      return;
    } catch (error) {
      console.error("[whatsappBot] Planner generation failed:", error);
      await message.reply(
        "I understood your request, but I could not generate a valid production plan. Please try a clearer duration, total hours, team size, or date such as 2026-07-13 or next Monday.",
      );
      return;
    }
  }

  await message.reply(
    "Demo bot received your message. Send 'ping', ask 'who are you?', try simple math like '12 x 4', or start a production plan request with 'plan:', 'production plan:', or 'create a production plan'.",
  );
});

client.initialize().catch((error: unknown) => {
  clearReadyWarningTimer();
  console.error("[whatsappBot] Failed to initialize:", error);
  process.exitCode = 1;
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("[whatsappBot] Unhandled rejection:", reason);
});

process.on("uncaughtException", (error: Error) => {
  console.error("[whatsappBot] Uncaught exception:", error);
  process.exitCode = 1;
});
