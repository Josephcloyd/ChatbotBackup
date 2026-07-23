import type { TemplateWorkbookDefinition } from "./templateService.js";

export interface ProductionPromptInput {
  projectDescription: string;
  templateDefinition: TemplateWorkbookDefinition;
  currentDate?: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function promptTemplate(definition: TemplateWorkbookDefinition): string {
  return JSON.stringify(
    definition.sheets.map((sheet) => ({
      sheetName: sheet.sheetName,
      columns: sheet.columns.map((column) => column.header),
      existingDataRowCount: sheet.metadata?.existingDataRowCount ?? 0,
    })),
    null,
    2,
  );
}

export class PromptService {
  buildProductionPrompt(input: ProductionPromptInput): string {
    return `/no_think
You are a production planning expert. Create a realistic plan for the requested project and populate the provided Excel workbook structure.
You do not simply generate schedules. You calculate feasibility, enforce dependencies, preserve actual progress, forecast completion, compare scenarios, and recommend the most realistic plan.

PROJECT DESCRIPTION
${input.projectDescription}

PLANNING DATE
${input.currentDate ?? todayIso()}

AUTHORITATIVE WORKBOOK TEMPLATE
${promptTemplate(input.templateDefinition)}

The workbook template above is the sole source of truth for workbook structure.
- Use ONLY the provided sheet names, with exact spelling and capitalization.
- For each sheet, use ONLY its provided column headers, copied exactly.
- Never invent, rename, normalize, abbreviate, or omit a column header.
- Preserve the provided column order exactly.
- Each row key must exactly match a column header for that row's sheet.
- Include every provided column in the sheet's columns array and in every row object.
- Provide 3 to 7 representative sample rows in the "rows" array. Do not generate every single daily row; the engine will automatically expand the full production schedule.
- If a value is unknown or not applicable, use an empty string.
- If a template sheet has no columns, return that sheet with empty columns and rows.
- Return only the template sheet or sheets relevant to the requested production plan.
- Prefer sheets with no existing data rows. Do not populate reference, credential, or account sheets unless the project explicitly requires them.
- Do not return the same sheet more than once.
- Treat the planning date as today. Unless the request explicitly asks for historical reporting, never use a past date.
- For the Production Plan sheet, create one row per calendar day when the request specifies a duration in days.
- When the request specifies total hours, the sum of all "Target Total Hours" values must equal that requested total exactly.
- This is a plan, not a completed report. Leave all future "Actual" fields, variance fields, and completion-rate fields as empty strings.
- Always validate the plan before presenting it.
- Never allow downstream work to exceed upstream completed work.
- Never restart an active project unless the user explicitly asks for a new plan.
- Never ignore staffing changes, leave, training, holidays, overtime limits, or labor budget constraints.
- If the plan is infeasible, explain why using numbers in the summary.
- If multiple solutions are possible, compare them and recommend the best option.
- Always separate planned values, actual values, and revised forecast values.
- Always produce structured output that can be used for Excel workbook generation.
CRITICAL MANDATORY INSTRUCTIONS:
- Your response MUST be a complete JSON object containing ALL THREE top-level keys: "project", "workbook", and "summary".
- Do NOT omit "workbook" or "summary".
- Inside "workbook", include "sheets" array with the sheet object(s) containing exact column names and populated row data for the plan schedule.

Respond with ONLY valid JSON matching this schema:
{
  "project": {
    "projectName": "string",
    "projectDescription": "string",
    "client": "string",
    "startDate": "string",
    "deadline": "string",
    "totalAssets": 0,
    "assumptions": ["string"]
  },
  "workbook": {
    "sheets": [
      {
        "sheetName": "an exact provided sheet name",
        "columns": ["exact provided column headers"],
        "rows": [
          { "exact column header": "string, number, boolean, null, or empty string" }
        ]
      }
    ]
  },
  "summary": "string"
}

JSON only. Do not include markdown or explanatory text.`;
  }
}

export const promptService = new PromptService();
