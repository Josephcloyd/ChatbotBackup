import { createRequire } from "node:module";
import { existsSync } from "node:fs";
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
const whatsAppClientId = (process.env.WHATSAPP_CLIENT_ID ?? "production-planner-v2").trim();
const botMentionDisplayName = (process.env.WHATSAPP_BOT_MENTION_NAME ?? "wil alt").trim();
const configuredBotMentionIds = (process.env.WHATSAPP_BOT_MENTION_ID ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter((id) => id.length > 0);
const chromeExecutablePath = findChromeExecutablePath();
const readyWarningTimeoutMs = 90_000;
let readyWarningTimer: NodeJS.Timeout | undefined;
let puppeteerDiagnosticsAttached = false;
const knownBotContactIds = new Set<string>();
type WhatsAppMessage = import("whatsapp-web.js").Message;
type WhatsAppChat = import("whatsapp-web.js").Chat;

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: whatsAppClientId,
    rmMaxRetries: 20,
  }),
  puppeteer: {
    ...(chromeExecutablePath ? { executablePath: chromeExecutablePath } : {}),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

function readNonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function findChromeExecutablePath(): string | undefined {
  const configuredPath = readNonEmptyEnv("WHATSAPP_CHROME_PATH");
  if (configuredPath) {
    return configuredPath;
  }

  const candidatePaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      : undefined,
    process.env.PROGRAMFILES
      ? `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`
      : undefined,
    process.env["PROGRAMFILES(X86)"]
      ? `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`
      : undefined,
  ].filter((path): path is string => Boolean(path));

  return candidatePaths.find((path) => existsSync(path));
}

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

  const displayId = formatWhatsAppIdForLog(chat.id);
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

function normalizeWhatsAppId(id: string): string {
  return id.trim().toLocaleLowerCase();
}

function addKnownBotContactId(id: string | undefined): void {
  if (!id?.trim()) {
    return;
  }

  knownBotContactIds.add(normalizeWhatsAppId(id));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createMentionNamePattern(displayName: string): RegExp | null {
  const normalizedName = displayName.replace(/^~/, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!normalizedName) {
    return null;
  }

  const escapedNamePattern = normalizedName
    .split(/\s+/)
    .map(escapeRegExp)
    .join("\\s+");

  return new RegExp(`@~?\\s*${escapedNamePattern}\\b`, "i");
}

function hasBotMentionDisplayName(text: string): boolean {
  const mentionPattern = createMentionNamePattern(botMentionDisplayName);
  const searchableText = text.replace(/[\u200B-\u200D\uFEFF]/g, "");
  return mentionPattern ? mentionPattern.test(searchableText) : false;
}

function stripBotMentionDisplayName(text: string): string {
  const mentionPattern = createMentionNamePattern(botMentionDisplayName);
  if (!mentionPattern) {
    return text;
  }

  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(new RegExp(mentionPattern.source, "gi"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCurrentBotContactIds(): Set<string> {
  const ids = [
    client.info?.wid?._serialized,
    client.info?.me?._serialized,
  ].filter((id): id is string => typeof id === "string" && id.trim().length > 0);

  for (const id of ids) {
    addKnownBotContactId(id);
  }

  for (const id of configuredBotMentionIds) {
    addKnownBotContactId(id);
  }

  return new Set(knownBotContactIds);
}

async function refreshKnownBotContactIds(): Promise<void> {
  const phoneId = client.info?.wid?._serialized ?? client.info?.me?._serialized;
  addKnownBotContactId(phoneId);

  if (!phoneId) {
    return;
  }

  try {
    // WhatsApp group mentions may use a @lid identifier even when client.info exposes @c.us.
    const contactMappings = await client.getContactLidAndPhone([phoneId]);
    for (const mapping of contactMappings) {
      addKnownBotContactId(mapping.lid);
      addKnownBotContactId(mapping.pn);
    }
  } catch (error) {
    console.warn(
      "[whatsappBot] Could not map bot phone ID to LID mention ID:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function isMessageMentioningBot(message: WhatsAppMessage): Promise<boolean> {
  if (hasBotMentionDisplayName(message.body)) {
    return true;
  }

  const botContactIds = getCurrentBotContactIds();

  if (botContactIds.size === 0) {
    console.warn("[whatsappBot] Could not determine bot contact ID; ignoring message because mention-only mode is enabled.");
    return false;
  }

  if (message.mentionedIds.some((mentionedId) => botContactIds.has(normalizeWhatsAppId(mentionedId)))) {
    return true;
  }

  await refreshKnownBotContactIds();
  const refreshedBotContactIds = getCurrentBotContactIds();
  return message.mentionedIds.some((mentionedId) => refreshedBotContactIds.has(normalizeWhatsAppId(mentionedId)));
}

function logIgnoredUnmentionedMessage(chatIdentity: ChatIdentity): void {
  console.log(
    `[whatsappBot] Ignored authorized group message because the bot was not mentioned. chatId=${maskWhatsAppGroupId(chatIdentity.id)}, chatName="${chatIdentity.name}"`,
  );
}

function formatWhatsAppIdForLog(id: string): string {
  return logFullGroupId ? id : maskWhatsAppGroupId(id);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

function isExpectedLogoutCleanupError(reason: unknown): boolean {
  const errorText = describeError(reason);
  return (
    errorText.includes("Execution context was destroyed") ||
    errorText.includes("EBUSY: resource busy or locked") ||
    errorText.includes("first_party_sets.db")
  );
}

function logWhatsAppSessionResetHelp(): void {
  console.warn(
    `[whatsappBot] To recover, close this bot and any Chrome/WhatsApp Web windows, then delete ".wwebjs_auth\\session-${whatsAppClientId}" and ".wwebjs_cache" from mcp-server before starting again.`,
  );
  console.warn("[whatsappBot] If WhatsApp shows this linked device as logged out, remove it from WhatsApp -> Linked devices, then scan the QR again.");
}

function getMessagePreview(message: WhatsAppMessage): string {
  const normalizedBody = message.body.replace(/\s+/g, " ").trim();
  if (normalizedBody.length <= 120) {
    return normalizedBody;
  }

  return `${normalizedBody.slice(0, 117)}...`;
}

async function getAuthorizedMessageContext(
  message: WhatsAppMessage,
): Promise<{ chat: WhatsAppChat | null; chatIdentity: ChatIdentity } | null> {
  if (groupAccessConfig.allowedGroupId) {
    const chatIdentity: ChatIdentity = {
      isGroup: message.from.endsWith("@g.us"),
      id: message.from,
      name: "(group name lookup skipped; WHATSAPP_ALLOWED_GROUP_ID is configured)",
    };

    if (!isAllowedWhatsAppGroup(chatIdentity, groupAccessConfig)) {
      console.log(
        `[whatsappBot] Ignored message outside allowed group. isGroup=${chatIdentity.isGroup}, chatId=${maskWhatsAppGroupId(chatIdentity.id)}, chatName="${chatIdentity.isGroup ? chatIdentity.name : "private chat"}"`,
      );
      return null;
    }

    return { chat: null, chatIdentity };
  }

  let chat: WhatsAppChat;
  try {
    chat = await message.getChat();
  } catch (error) {
    console.error(
      [
        "[whatsappBot] Could not load WhatsApp chat for an incoming message.",
        `from=${formatWhatsAppIdForLog(message.from)}`,
        `id=${message.id?._serialized ?? "(unknown)"}`,
        `type=${message.type}`,
        `body="${getMessagePreview(message)}"`,
        `error=${describeError(error)}`,
      ].join(" "),
    );
    console.error(
      "[whatsappBot] This usually comes from WhatsApp Web/Puppeteer chat lookup. Configure WHATSAPP_ALLOWED_GROUP_ID to avoid the fragile group-name lookup path, then restart the bot.",
    );
    return null;
  }

  const chatIdentity: ChatIdentity = {
    isGroup: chat.isGroup,
    id: chat.id._serialized,
    name: chat.name,
  };

  if (!isAllowedWhatsAppGroup(chatIdentity, groupAccessConfig)) {
    console.log(
      `[whatsappBot] Ignored message outside allowed group. isGroup=${chatIdentity.isGroup}, chatId=${maskWhatsAppGroupId(chatIdentity.id)}, chatName="${chatIdentity.isGroup ? chatIdentity.name : "private chat"}"`,
    );
    return null;
  }

  return { chat, chatIdentity };
}

console.log("[whatsappBot] Starting WhatsApp QR demo bot.");
console.log(`[whatsappBot] LocalAuth clientId: ${whatsAppClientId}`);
console.log(`[whatsappBot] Mention display name: @${botMentionDisplayName}`);
console.log(`[whatsappBot] Chrome executable: ${chromeExecutablePath ?? "(auto/default)"}`);
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
  void refreshKnownBotContactIds();
  console.log("[whatsappBot] WhatsApp QR demo bot is ready.");
  console.log("[whatsappBot] Mention the bot in the allowed group, then send 'ping' to test replies.");
  console.log(`[whatsappBot] Mention the bot with a command. ${productionPlanCommandHelp}`);
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
  if (reason === "LOGOUT") {
    console.warn("[whatsappBot] WhatsApp logged out this LocalAuth session.");
    logWhatsAppSessionResetHelp();
  }
});

client.on("message", async (message) => {
  if (message.fromMe) {
    return;
  }

  try {
    const messageContext = await getAuthorizedMessageContext(message);
    if (!messageContext) {
      return;
    }

    const { chatIdentity } = messageContext;

    logApprovedFallbackGroup(chatIdentity);

    if (!(await isMessageMentioningBot(message))) {
      logIgnoredUnmentionedMessage(chatIdentity);
      return;
    }

    const text = message.body.trim();
    const commandText = stripBotMentionDisplayName(text);
    const normalizedText = normalizeBotMessageText(commandText);

    console.log("[whatsappBot] Authorized mentioned message received.");

    if (normalizedText.toLowerCase() === "ping") {
      await message.reply(
        `Production Planner WhatsApp demo bot is connected. ${productionPlanCommandHelp}`,
      );
      return;
    }

    const socialReply = getSocialReply(commandText);
    if (socialReply) {
      await message.reply(socialReply);
      return;
    }

    const mathReply = getSimpleMathReply(commandText);
    if (mathReply) {
      await message.reply(mathReply);
      return;
    }

    const command = parseProductionPlanCommand(commandText);
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

        await client.sendMessage(message.from, workbookMedia, {
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
  } catch (error) {
    console.error(
      [
        "[whatsappBot] Message handler failed.",
        `from=${formatWhatsAppIdForLog(message.from)}`,
        `id=${message.id?._serialized ?? "(unknown)"}`,
        `type=${message.type}`,
        `body="${getMessagePreview(message)}"`,
        `error=${describeError(error)}`,
      ].join(" "),
    );
  }
});

client.initialize().catch((error: unknown) => {
  clearReadyWarningTimer();
  console.error("[whatsappBot] Failed to initialize:", error);
  process.exitCode = 1;
});

process.on("unhandledRejection", (reason: unknown) => {
  if (isExpectedLogoutCleanupError(reason)) {
    console.warn("[whatsappBot] WhatsApp Web cleanup warning after logout:", describeError(reason));
    logWhatsAppSessionResetHelp();
    return;
  }

  console.error("[whatsappBot] Unhandled rejection:", reason);
});

process.on("uncaughtException", (error: Error) => {
  console.error("[whatsappBot] Uncaught exception:", error);
  process.exitCode = 1;
});
