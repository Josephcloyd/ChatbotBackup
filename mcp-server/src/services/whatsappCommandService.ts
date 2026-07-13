export interface ProductionPlanCommand {
  projectDescription: string;
}

const mentionTokenPattern = /@\S+/g;

const productionPlanCommandPattern =
  /^(?:plan|production\s+plan|create\s+(?:a\s+)?production\s+plan)\b\s*(?::|-)?\s*([\s\S]*)$/i;

const botIdentityPattern =
  /^(?:who\s+are\s+you|what\s+are\s+you|introduce\s+yourself|about\s+you)\??$/i;

const botHelpPattern =
  /^(?:help|what\s+can\s+you\s+do|commands|how\s+do\s+i\s+use\s+you)\??$/i;

const simpleMathPattern =
  /^(?:what(?:'s| is)?|calculate|compute|solve)?\s*(-?\d+(?:\.\d+)?)\s*(\+|-|\*|x|×|\/|÷|plus|minus|times|multiplied\s+by|divided\s+by)\s*(-?\d+(?:\.\d+)?)\s*\??$/i;

export function normalizeBotMessageText(text: string): string {
  return text.replace(mentionTokenPattern, " ").replace(/\s+/g, " ").trim();
}

export function parseProductionPlanCommand(text: string): ProductionPlanCommand | null {
  const match = normalizeBotMessageText(text).match(productionPlanCommandPattern);
  if (!match) {
    return null;
  }

  return {
    projectDescription: (match[1] ?? "").trim(),
  };
}

export function getSocialReply(text: string): string | null {
  const normalized = normalizeBotMessageText(text);

  if (botIdentityPattern.test(normalized)) {
    return [
      "I'm your Flowboard production-planning assistant.",
      "I can help turn a project request into a production plan, workbook, and dashboard history entry.",
      `Try: ${productionPlanCommandExample}`,
    ].join("\n");
  }

  if (botHelpPattern.test(normalized)) {
    return [
      productionPlanCommandHelp,
      "You can also say 'ping', ask 'who are you?', or send simple math like '12 x 4'.",
    ].join("\n");
  }

  return null;
}

export function getSimpleMathReply(text: string): string | null {
  const normalized = normalizeBotMessageText(text);
  const match = normalized.match(simpleMathPattern);

  if (!match) return null;

  const left = Number(match[1]);
  const operator = match[2].toLowerCase();
  const right = Number(match[3]);

  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;

  let result: number;
  if (operator === "+" || operator === "plus") {
    result = left + right;
  } else if (operator === "-" || operator === "minus") {
    result = left - right;
  } else if (
    operator === "*" ||
    operator === "x" ||
    operator === "×" ||
    operator === "times" ||
    operator === "multiplied by"
  ) {
    result = left * right;
  } else if (operator === "/" || operator === "÷" || operator === "divided by") {
    if (right === 0) return "I cannot divide by zero.";
    result = left / right;
  } else {
    return null;
  }

  return `${left} ${operator} ${right} = ${Number.isInteger(result) ? result : Number(result.toFixed(6))}`;
}

export const productionPlanCommandHelp =
  "Send a message starting with 'plan:', 'production plan:', or 'create a production plan' to generate a production plan.";

export const productionPlanCommandExample =
  "production plan: Create a 1-week production plan for a student enrollment encoding project with 8 total hours.";
