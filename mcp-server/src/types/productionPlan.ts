export type ProductionPlanCellValue = string | number | boolean | null;

export type ProductionPlanRow = Record<string, ProductionPlanCellValue>;

export type ProductionPlanColumnSemantic =
  | "sequence"
  | "date"
  | "month"
  | "day"
  | "phase"
  | "planned_staff"
  | "role_headcount"
  | "planned_output"
  | "planned_output_per_person"
  | "actual_staff"
  | "actual_output"
  | "actual_output_per_person"
  | "planned_hours"
  | "actual_hours"
  | "variance"
  | "completion_rate"
  | "status"
  | "notes"
  | "custom";

export type ProductionPlanColumnDataType =
  | "text"
  | "integer"
  | "decimal"
  | "date"
  | "percentage";

export interface ProductionPlanColumnDefinition {
  key: string;
  label: string;
  semantic: ProductionPlanColumnSemantic;
  dataType: ProductionPlanColumnDataType;
  editable: boolean;
  role?: string;
}

export interface ProductionPlanProject {
  projectName: string;
  projectDescription: string;
  client: string;
  startDate: string;
  deadline: string;
  totalAssets: number;
  assumptions: string[];
  projectCategory?: string;
  productionUnit?: string;
  feasibilityStatus?: string;
  requiredDailyOutput?: number;
  utilizationPercent?: number;
}

export interface ProductionPlanSheet {
  sheetName: string;
  columns: string[];
  columnDefinitions?: ProductionPlanColumnDefinition[];
  rows: ProductionPlanRow[];
}

export interface ProductionPlan {
  project: ProductionPlanProject;
  workbook: {
    sheets: ProductionPlanSheet[];
  };
  summary: string;
}

export interface ProductionPlanInput {
  whatsappUserId: string;
  projectDescription: string;
  workbookMode?: "template" | "dynamic";
  selectedTemplate?: string;
  generationSource?: "whatsapp" | "dashboard" | "api" | "admin";
}
