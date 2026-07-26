export type AccessibilityViolationSignature = {
  ruleId: string;
  impact: "serious" | "critical";
  target: string;
};

// This is a debt ledger, not an axe waiver. PR 9 must fix these nodes and
// intentionally reduce this baseline to an empty array. Any addition, removal,
// selector change, rule change, or severity change requires a reviewed update.
export const LANDING_ACCESSIBILITY_BASELINE = [
  {
    ruleId: "color-contrast",
    impact: "serious",
    target: String.raw`.bg-primary\/5`,
  },
  { ruleId: "color-contrast", impact: "serious", target: ".gap-1" },
  {
    ruleId: "color-contrast",
    impact: "serious",
    target: String.raw`.gap-3.flex.items-center > .px-8.shadow-\[0_12px_32px_hsl\(var\(--primary\)\/0\.2\)\].bg-primary`,
  },
  {
    ruleId: "color-contrast",
    impact: "serious",
    target: String.raw`.pt-20 > .text-muted-foreground\/70.mt-3.gap-2 > span`,
  },
  {
    ruleId: "color-contrast",
    impact: "serious",
    target: String.raw`.pt-20 > .tracking-\[0\.35em\].text-primary.uppercase`,
  },
  { ruleId: "color-contrast", impact: "serious", target: ".shadow" },
  {
    ruleId: "color-contrast",
    impact: "serious",
    target: String.raw`.shadow-\[0_8px_24px_hsl\(var\(--primary\)\/0\.18\)\]`,
  },
  {
    ruleId: "color-contrast",
    impact: "serious",
    target: String.raw`div:nth-child(1) > .tracking-\[0\.2em\].text-muted-foreground\/60.text-\[11px\]`,
  },
  {
    ruleId: "color-contrast",
    impact: "serious",
    target: String.raw`div:nth-child(2) > .tracking-\[0\.2em\].text-muted-foreground\/60.text-\[11px\]`,
  },
] as const satisfies readonly AccessibilityViolationSignature[];
