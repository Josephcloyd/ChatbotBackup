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

const productionPlanningSignals = [
  /\bproduction\s+plan\b/i,
  /\b(?:plan|schedule|timeline|workload|capacity|resource|staffing|throughput|daily\s+target|target\s+(?:output|quantity|volume))\b/i,
  /\b(?:project|operation|workflow|milestone|deadline|timeframe|duration)\b/i,
  /\b(?:collect|capture|process|produce|manufacture|encode|annotate|validate|review|deliver|complete|handle)\b/i,
  /\b(?:images?|records?|documents?|receipts?|invoices?|forms?|items?|files?|responses?|entries?|clips?|pages?|units?|samples?|videos?|tasks?|features?|modules?|tickets?|articles?|posts?|batches?|participants?|transactions?|hours?)\b/i,
  /\b(?:days?|weeks?|months?|starting|start\s+date|deadline|today|tomorrow|next\s+\w+)\b/i,
  /\b\d[\d,]*(?:\.\d+)?\b/,
];

const generalQuestionPattern =
  /^(?:what(?:'s| is)?|where|when|who|why|how|can\s+you|could\s+you|tell\s+me)\b/i;

export function normalizeBotMessageText(text: string): string {
  return text.replace(mentionTokenPattern, " ").replace(/\s+/g, " ").trim();
}

export function parseProductionPlanCommand(
  text: string,
): ProductionPlanCommand | null {
  const match = normalizeBotMessageText(text).match(
    productionPlanCommandPattern,
  );
  if (!match) {
    return null;
  }

  return {
    projectDescription: (match[1] ?? "").trim(),
  };
}

export function isProductionPlanningRequest(text: string): boolean {
  const normalized = normalizeBotMessageText(text);
  if (!normalized) return false;
  if (parseProductionPlanCommand(normalized)) return true;

  const score = productionPlanningSignals.reduce(
    (total, pattern) => total + (pattern.test(normalized) ? 1 : 0),
    0,
  );
  const hasPlanningNoun =
    /\b(?:plan|schedule|timeline|workload|capacity|resource|staffing|throughput|target|deadline|timeframe|duration|workflow|milestone)\b/i.test(
      normalized,
    );
  const hasOperationalVerb =
    /\b(?:collect|capture|process|produce|manufacture|encode|annotate|validate|review|deliver|complete|handle)\b/i.test(
      normalized,
    );
  const hasMeasurableWork =
    /\b\d[\d,]*(?:\.\d+)?\b[\s\S]{0,24}\b(?:images?|records?|documents?|receipts?|invoices?|forms?|items?|files?|responses?|entries?|clips?|pages?|units?|samples?|videos?|tasks?|features?|modules?|tickets?|articles?|posts?|batches?|participants?|transactions?|hours?)\b/i.test(
      normalized,
    ) ||
    /\b(?:images?|records?|documents?|receipts?|invoices?|forms?|items?|files?|responses?|entries?|clips?|pages?|units?|samples?|videos?|tasks?|features?|modules?|tickets?|articles?|posts?|batches?|participants?|transactions?|hours?)\b[\s\S]{0,48}\b\d[\d,]*(?:\.\d+)?\b/i.test(
      normalized,
    );
  const hasDuration =
    /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:days?|weeks?|months?|hours?)\b/i.test(
      normalized,
    );

  if (
    generalQuestionPattern.test(normalized) &&
    !hasOperationalVerb &&
    !hasMeasurableWork
  ) {
    return false;
  }

  return (
    score >= 4 ||
    (hasOperationalVerb && hasMeasurableWork) ||
    (hasPlanningNoun && hasOperationalVerb && hasDuration)
  );
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
  } else if (
    operator === "/" ||
    operator === "÷" ||
    operator === "divided by"
  ) {
    if (right === 0) return "I cannot divide by zero.";
    result = left / right;
  } else {
    return null;
  }

  return `${left} ${operator} ${right} = ${Number.isInteger(result) ? result : Number(result.toFixed(6))}`;
}

export const productionPlanCommandHelp =
  "Mention me with a project description to generate a dynamic production plan. Starting with 'plan:' is optional.";

export const productionPlanCommandExample =
  "Create a 6-month production plan for collecting 350,000 images starting today.";
