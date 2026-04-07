import { Check, DatabaseZap, Github, Search } from "lucide-react";

const STEPS = [
  { label: "Connect", icon: Github },
  { label: "Index", icon: DatabaseZap },
  { label: "Search", icon: Search },
] as const;

type OnboardingStepperProps = {
  currentStep: 1 | 2 | 3;
};

export function OnboardingStepper({ currentStep }: OnboardingStepperProps) {
  return (
    <div className="flex items-center gap-3">
      {STEPS.map((step, index) => {
        const stepNum = (index + 1) as 1 | 2 | 3;
        const Icon = step.icon;
        const isCompleted = stepNum < currentStep;
        const isActive = stepNum === currentStep;

        return (
          <div key={step.label} className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors ${
                  isCompleted
                    ? "bg-primary text-primary-foreground"
                    : isActive
                      ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : <Icon className="h-3.5 w-3.5" />}
              </div>
              <span className={`text-sm font-medium ${isActive ? "text-foreground" : isCompleted ? "text-foreground" : "text-muted-foreground"}`}>
                {step.label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <div className={`h-px w-8 ${isCompleted ? "bg-primary" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
