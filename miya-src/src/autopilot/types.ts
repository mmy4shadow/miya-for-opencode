export interface AutopilotPlanStep {
  id: string;
  title: string;
  done: boolean;
}

export interface AutopilotPlan {
  goal: string;
  createdAt: string;
  steps: AutopilotPlanStep[];
}

