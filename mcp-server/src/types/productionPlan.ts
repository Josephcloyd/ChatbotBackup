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
  summary: string;
}

export interface ProductionPlanInput {
  whatsappUserId: string;
  projectDescription: string;
  workbookMode?: "template" | "dynamic";
  selectedTemplate?: string;
}
