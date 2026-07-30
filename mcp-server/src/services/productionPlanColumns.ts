import type {
  ProductionPlanColumnDefinition,
  ProductionPlanColumnSemantic,
  ProductionPlanRow,
  ProductionPlanSheet,
} from "../types/productionPlan.js";

function inferredSemantic(label: string): ProductionPlanColumnSemantic {
  const normalized = label.trim().toLowerCase();

  if (/^(?:no\.?|number|sequence|#)$/.test(normalized)) return "sequence";
  if (/^(?:work\s+)?date$/.test(normalized)) return "date";
  if (/month|period/.test(normalized)) return "month";
  if (/^(?:day|weekday)$/.test(normalized)) return "day";
  if (/phase|stage/.test(normalized)) return "phase";
  if (/status/.test(normalized)) return "status";
  if (/note|comment/.test(normalized)) return "notes";
  if (/completion.*(?:%|rate)|(?:%|rate).*completion/.test(normalized)) return "completion_rate";
  if (/variance|difference|gap/.test(normalized)) return "variance";
  if (/actual/.test(normalized) && /per\s+(?:person|worker|annotator|resource|staff)/.test(normalized)) {
    return "actual_output_per_person";
  }
  if (/(?:target|planned)/.test(normalized) && /per\s+(?:person|worker|annotator|resource|staff)/.test(normalized)) {
    return "planned_output_per_person";
  }
  if (/actual/.test(normalized) && /(?:staff|team|worker|annotator|resource|recorder|validator|developer|operator)/.test(normalized)) {
    return "actual_staff";
  }
  if (/(?:target|planned|scheduled)/.test(normalized) && /(?:staff|team|worker|annotator|resource)/.test(normalized)) {
    return "planned_staff";
  }
  if (/actual/.test(normalized) && /total\s+hours?/.test(normalized)) return "actual_output";
  if (/(?:target|planned)/.test(normalized) && /total\s+hours?/.test(normalized)) return "planned_output";
  if (/actual/.test(normalized) && /hours?/.test(normalized)) return "actual_hours";
  if (/(?:target|planned|capacity)/.test(normalized) && /hours?/.test(normalized)) return "planned_hours";
  if (/actual/.test(normalized)) return "actual_output";
  if (/(?:target|planned|assigned|scheduled)/.test(normalized)) return "planned_output";

  return "custom";
}

function inferredDataType(
  semantic: ProductionPlanColumnSemantic,
): ProductionPlanColumnDefinition["dataType"] {
  if (semantic === "date") return "date";
  if (semantic === "completion_rate") return "percentage";
  if (
    semantic === "sequence" ||
    semantic === "planned_staff" ||
    semantic === "role_headcount" ||
    semantic === "actual_staff"
  ) {
    return "integer";
  }
  if (
    semantic === "planned_output" ||
    semantic === "planned_output_per_person" ||
    semantic === "actual_output" ||
    semantic === "actual_output_per_person" ||
    semantic === "planned_hours" ||
    semantic === "actual_hours" ||
    semantic === "variance"
  ) {
    return "decimal";
  }
  return "text";
}

export function getColumnDefinitions(
  sheet: Pick<ProductionPlanSheet, "columns" | "columnDefinitions">,
): ProductionPlanColumnDefinition[] {
  if (sheet.columnDefinitions?.length) return sheet.columnDefinitions;

  return sheet.columns.map((label, index) => {
    const semantic = inferredSemantic(label);
    return {
      key: `legacy_${index + 1}`,
      label,
      semantic,
      dataType: inferredDataType(semantic),
      editable:
        semantic === "actual_staff" ||
        semantic === "actual_output" ||
        semantic === "actual_hours" ||
        semantic === "notes",
    };
  });
}

export function findColumnDefinition(
  sheet: Pick<ProductionPlanSheet, "columns" | "columnDefinitions">,
  semantic: ProductionPlanColumnSemantic,
): ProductionPlanColumnDefinition | undefined {
  return getColumnDefinitions(sheet).find((column) => column.semantic === semantic);
}

export function findColumnLabel(
  sheet: Pick<ProductionPlanSheet, "columns" | "columnDefinitions">,
  semantic: ProductionPlanColumnSemantic,
): string | undefined {
  return findColumnDefinition(sheet, semantic)?.label;
}

export function getSemanticCell(
  row: ProductionPlanRow,
  sheet: Pick<ProductionPlanSheet, "columns" | "columnDefinitions">,
  semantic: ProductionPlanColumnSemantic,
): ProductionPlanRow[string] | undefined {
  const label = findColumnLabel(sheet, semantic);
  return label ? row[label] : undefined;
}
