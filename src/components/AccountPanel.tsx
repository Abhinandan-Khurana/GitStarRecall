import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, LogOut, Trash2, AlertTriangle } from "lucide-react";

interface AccountPanelProps {
  authMethod: string | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onLogout: () => void;
  onClearLocalData: () => void;
  onOAuthLogin: () => void;
}

export function AccountPanel({
  authMethod,
  expanded,
  onExpandedChange,
  onLogout,
  onClearLocalData,
  onOAuthLogin,
}: AccountPanelProps) {
  return (
    <Collapsible open={expanded} onOpenChange={onExpandedChange}>
      <div className="rounded-xl border border-border/50 bg-card/40">
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-muted/20">
            <span className="font-medium text-foreground">Account</span>
            <span className="flex items-center gap-2">
              {authMethod ? (
                <Badge variant="secondary" className="text-xs font-normal">
                  {authMethod === "oauth" ? "OAuth" : "PAT"}
                </Badge>
              ) : null}
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-3 border-t border-border/50 px-4 py-3">
            {authMethod === "pat" ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <p className="text-xs text-amber-200">
                  You are using a Personal Access Token. For better security,{" "}
                  <button
                    onClick={onOAuthLogin}
                    className="font-medium underline underline-offset-2 transition-colors hover:text-amber-100"
                  >
                    switch to GitHub OAuth
                  </button>.
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={onLogout}>
                <LogOut className="h-3 w-3" />
                Clear token
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={onClearLocalData}
              >
                <Trash2 className="h-3 w-3" />
                Delete local data
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
