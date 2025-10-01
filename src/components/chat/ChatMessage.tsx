import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Bot } from "lucide-react";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  agentType?: string;
}

export const ChatMessage = ({ role, content, agentType }: ChatMessageProps) => {
  const isUser = role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2 duration-500`}>
      {!isUser && (
        <Avatar className="h-8 w-8 border-2 border-primary/20">
          <AvatarFallback className="bg-gradient-to-br from-primary to-secondary text-primary-foreground">
            <Bot className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}
      
      <div className={`flex flex-col gap-1 max-w-[80%] ${isUser ? "items-end" : "items-start"}`}>
        {!isUser && agentType && (
          <Badge variant="secondary" className="text-xs font-medium">
            {agentType}
          </Badge>
        )}
        <Card className={`p-3 ${
          isUser 
            ? "bg-primary text-primary-foreground shadow-soft" 
            : "bg-card shadow-soft"
        }`}>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
        </Card>
      </div>

      {isUser && (
        <Avatar className="h-8 w-8 border-2 border-muted">
          <AvatarFallback className="bg-muted text-muted-foreground">
            <User className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
};
