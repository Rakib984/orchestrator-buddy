import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { ChatInput } from "@/components/chat/ChatInput";
import { AgentIndicator } from "@/components/chat/AgentIndicator";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

type Message = {
  role: "user" | "assistant";
  content: string;
  agentType?: string;
};

const Index = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hello! I'm your HR Assistant. I can help you with benefits, leave requests, company policies, and general HR questions. What can I help you with today?",
      agentType: "HR Assistant",
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<string | undefined>();

  const handleSend = async (userMessage: string) => {
    const newUserMessage: Message = { role: "user", content: userMessage };
    setMessages((prev) => [...prev, newUserMessage]);
    setIsLoading(true);
    setCurrentAgent(undefined);

    let assistantResponse = "";
    let detectedAgent: string | undefined;

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hr-orchestrator`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            messages: [...messages, newUserMessage].map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
        }
      );

      if (!response.ok || !response.body) {
        throw new Error("Failed to get response");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") {
            streamDone = true;
            break;
          }

          try {
            const parsed = JSON.parse(jsonStr);
            
            // Check for agent metadata
            if (parsed.choices?.[0]?.delta?.agent) {
              detectedAgent = parsed.choices[0].delta.agent;
              setCurrentAgent(detectedAgent);
              continue;
            }

            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantResponse += content;
              setMessages((prev) => {
                const lastMessage = prev[prev.length - 1];
                if (lastMessage?.role === "assistant") {
                  return prev.map((m, i) =>
                    i === prev.length - 1
                      ? { ...m, content: assistantResponse, agentType: detectedAgent }
                      : m
                  );
                }
                return [
                  ...prev,
                  {
                    role: "assistant" as const,
                    content: assistantResponse,
                    agentType: detectedAgent,
                  },
                ];
              });
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      // Final flush
      if (buffer.trim()) {
        for (let raw of buffer.split("\n")) {
          if (!raw || raw.startsWith(":") || raw.trim() === "") continue;
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantResponse += content;
              setMessages((prev) => {
                const lastMessage = prev[prev.length - 1];
                if (lastMessage?.role === "assistant") {
                  return prev.map((m, i) =>
                    i === prev.length - 1
                      ? { ...m, content: assistantResponse, agentType: detectedAgent }
                      : m
                  );
                }
                return [
                  ...prev,
                  {
                    role: "assistant" as const,
                    content: assistantResponse,
                    agentType: detectedAgent,
                  },
                ];
              });
            }
          } catch {
            // Ignore
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      toast.error("Failed to get response. Please try again.");
    } finally {
      setIsLoading(false);
      setCurrentAgent(undefined);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/30">
      <div className="container max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 text-center animate-in fade-in slide-in-from-top duration-700">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="p-2 bg-gradient-to-br from-primary to-secondary rounded-lg shadow-soft">
              <Sparkles className="h-6 w-6 text-primary-foreground" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              HR Assistant
            </h1>
          </div>
          <p className="text-muted-foreground">
            Powered by intelligent agent orchestration
          </p>
        </div>

        {/* Chat Container */}
        <Card className="shadow-medium border-border/50 backdrop-blur-sm bg-card/95 animate-in fade-in slide-in-from-bottom duration-700">
          <ScrollArea className="h-[500px] p-6">
            <div className="space-y-4">
              {messages.map((message, index) => (
                <ChatMessage
                  key={index}
                  role={message.role}
                  content={message.content}
                  agentType={message.agentType}
                />
              ))}
              {isLoading && <AgentIndicator agentType={currentAgent} isProcessing={true} />}
            </div>
          </ScrollArea>

          <div className="border-t border-border p-4 bg-muted/30">
            <ChatInput onSend={handleSend} disabled={isLoading} />
          </div>
        </Card>

        {/* Footer Info */}
        <div className="mt-4 text-center text-xs text-muted-foreground animate-in fade-in delay-300 duration-700">
          <p>Try asking about benefits, leave policies, or company guidelines</p>
        </div>
      </div>
    </div>
  );
};

export default Index;
