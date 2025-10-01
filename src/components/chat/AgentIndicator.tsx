import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2 } from "lucide-react";

interface AgentIndicatorProps {
  agentType?: string;
  isProcessing: boolean;
}

export const AgentIndicator = ({ agentType, isProcessing }: AgentIndicatorProps) => {
  if (!isProcessing && !agentType) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 rounded-lg border border-border animate-in fade-in slide-in-from-bottom-2 duration-300">
      {isProcessing ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">
            {agentType ? `${agentType} is processing...` : "Routing to agent..."}
          </span>
        </>
      ) : (
        <>
          <CheckCircle2 className="h-4 w-4 text-accent" />
          <span className="text-sm text-muted-foreground">
            Handled by <Badge variant="secondary" className="ml-1">{agentType}</Badge>
          </span>
        </>
      )}
    </div>
  );
};
