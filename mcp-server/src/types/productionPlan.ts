export type ProductionPlanCellValue = string | number | boolean | null;

export type ProductionPlanRow = Record<string, ProductionPlanCellValue>;

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

export interface StructuredPlanningOutput {
  projectSummary: {
    targetRecords: number;
    duration: string;
    deadline: string;
    laborBudgetHours: number;
    feasible: boolean;
  };
  parsedInputs: {
    roles: string[];
    dependencies: string[];
    constraints: string[];
    productivityRates: string[];
  };
  capacityAnalysis: {
    workingDays: number;
    availableHours: number;
    effectiveCapacity: number;
    capacityShortfall: number;
  };
  schedule: ProductionPlanRow[];
  resourceAllocation: ProductionPlanRow[];
  forecast: {
    revisedCompletionDate: string;
    scheduleVarianceDays: number;
    laborVarianceHours: number;
    bottleneckPhase: string;
  };
  replanning: {
    isReplan: boolean;
    preservedCompletedWork: boolean;
    staffingChanges: ProductionPlanRow[];
    remainingWork: ProductionPlanRow[];
  };
  scenarios: ProductionPlanRow[];
  recommendedScenario: {
    name: string;
    reason: string;
    costImpact: string;
    scheduleImpact: string;
    riskLevel: string;
  };
  risks: ProductionPlanRow[];
  excelWorkbook: {
    sheets: string[];
  };
}

export interface ProductionPlanSheet {
  sheetName: string;
  columns: string[];
  rows: ProductionPlanRow[];
}

export interface ProductionPlan {
  project: ProductionPlanProject;
  workbook: {
    sheets: ProductionPlanSheet[];
  };
  structuredPlan?: StructuredPlanningOutput;
  summary: string;
}

export interface ProductionPlanInput {
  whatsappUserId: string;
  projectDescription: string;
  workbookMode?: "template" | "dynamic";
  selectedTemplate?: string;
  generationSource?: "whatsapp" | "dashboard" | "api" | "admin";
  requestedBy?: string | null;
}
