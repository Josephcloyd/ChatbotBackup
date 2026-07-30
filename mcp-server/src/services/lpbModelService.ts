export const LPB_STAGE_DEFINITIONS = [
  { code: "L", label: "LPB-L", workloadPercentage: 20 },
  { code: "P", label: "LPB-P", workloadPercentage: 50 },
  { code: "B", label: "LPB-B", workloadPercentage: 30 },
] as const;

export type LpbStageCode = typeof LPB_STAGE_DEFINITIONS[number]["code"];

export interface LpbDailyAllocation {
  stageCode: LpbStageCode;
  stageLabel: string;
  workloadPercentage: number;
  target: number;
}

export interface LpbStageAllocation {
  stageCode: LpbStageCode;
  stageLabel: string;
  workloadPercentage: number;
  scheduledDays: number;
  startIndex: number;
  endIndex: number;
  target: number;
}

export interface LpbDistribution {
  daily: LpbDailyAllocation[];
  stages: LpbStageAllocation[];
}

function allocateIntegerByPercentage(total: number, percentages: readonly number[]): number[] {
  const raw = percentages.map((percentage) => (total * percentage) / 100);
  const allocated = raw.map(Math.floor);
  let remainder = total - allocated.reduce((sum, value) => sum + value, 0);
  const priority = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  for (let index = 0; remainder > 0; index += 1, remainder -= 1) {
    allocated[priority[index % priority.length]!.index]! += 1;
  }
  return allocated;
}

function distributeInteger(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function buildLpbDistribution(
  totalWorkload: number,
  scheduledDays: number,
  decimalPlaces: 0 | 2,
): LpbDistribution {
  if (!Number.isFinite(totalWorkload) || totalWorkload <= 0) {
    throw new Error("LPB workload must be greater than zero");
  }
  if (!Number.isInteger(scheduledDays) || scheduledDays < LPB_STAGE_DEFINITIONS.length) {
    throw new Error("LPB Model requires at least 3 scheduled workdays");
  }

  const percentages = LPB_STAGE_DEFINITIONS.map((stage) => stage.workloadPercentage);
  const stageDayCounts = allocateIntegerByPercentage(scheduledDays, percentages);
  const scale = 10 ** decimalPlaces;
  const totalUnits = Math.round(totalWorkload * scale);
  const stageTargetUnits = allocateIntegerByPercentage(totalUnits, percentages);
  const daily: LpbDailyAllocation[] = [];
  const stages: LpbStageAllocation[] = [];
  let startIndex = 0;

  LPB_STAGE_DEFINITIONS.forEach((stage, index) => {
    const scheduledStageDays = stageDayCounts[index]!;
    const stageUnits = stageTargetUnits[index]!;
    const dailyUnits = distributeInteger(stageUnits, scheduledStageDays);
    const endIndex = startIndex + scheduledStageDays - 1;

    stages.push({
      stageCode: stage.code,
      stageLabel: stage.label,
      workloadPercentage: stage.workloadPercentage,
      scheduledDays: scheduledStageDays,
      startIndex,
      endIndex,
      target: stageUnits / scale,
    });
    dailyUnits.forEach((targetUnits) => {
      daily.push({
        stageCode: stage.code,
        stageLabel: stage.label,
        workloadPercentage: stage.workloadPercentage,
        target: targetUnits / scale,
      });
    });
    startIndex = endIndex + 1;
  });

  return { daily, stages };
}
