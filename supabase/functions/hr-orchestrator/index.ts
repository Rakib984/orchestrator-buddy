import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Received messages:", messages);

    // Extract the latest user message
    const latestUserMessage = messages.filter((m: any) => m.role === "user").slice(-1)[0]?.content || "";
    
    console.log("Latest user message:", latestUserMessage);

    // Step 1: Determine which sub-agent should handle this request
    const routingResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are an HR Orchestrator Agent. Your job is to analyze user requests and route them to the appropriate sub-agent.

DECISION RULES:
1. ONBOARDING_AGENT - Use for: adding new employees, scheduling orientation, onboarding tasks, welcome packs, employee setup
   Keywords: "onboard", "new employee", "hire", "orientation", "welcome", "start date", "new hire"

2. FAQ_AGENT - Use for: questions about HR policies, work hours, vacation, sick leave, payroll, benefits, training programs, remote work, company policies
   Keywords: "how many", "when", "what is", "policy", "vacation", "sick leave", "payroll", "benefits", "training program", "remote work", "work from home"

3. TASK_REMINDER_AGENT - Use for: reminders, checking tasks, task management, overdue items, task summaries, pending work, compliance tasks, training tasks
   Keywords: "task", "remind", "reminder", "pending", "overdue", "check", "summary", "to-do", "management", "progress", "status"

4. NO_MATCH - Only use if the request is completely unrelated to HR (like weather, sports, random topics)

Be flexible with typos and variations. If a request seems HR-related, pick the best matching agent.

Examples:
- "Onboard Alice Smith" → ONBOARDING_AGENT
- "How many vacation days?" → FAQ_AGENT
- "task managment" → TASK_REMINDER_AGENT
- "remind about training" → TASK_REMINDER_AGENT
- "What's for lunch?" → NO_MATCH

Respond with ONLY the agent name. No additional text.`,
          },
          {
            role: "user",
            content: latestUserMessage,
          },
        ],
      }),
    });

    if (!routingResponse.ok) {
      console.error("Routing error:", await routingResponse.text());
      throw new Error("Failed to route request");
    }

    const routingData = await routingResponse.json();
    const selectedAgent = routingData.choices[0].message.content.trim();
    
    console.log("Selected agent:", selectedAgent);

    // Handle NO_MATCH case
    if (selectedAgent === "NO_MATCH") {
      const noMatchMessage = "I don't have an agent for this request. Please contact HR directly for assistance with this matter.";
      
      const stream = new ReadableStream({
        start(controller) {
          const response = `data: ${JSON.stringify({
            choices: [{
              delta: { 
                agent: "HR Assistant",
                content: noMatchMessage
              }
            }]
          })}\n\n`;
          controller.enqueue(new TextEncoder().encode(response));
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // Map agent names to friendly display names
    const agentDisplayNames: Record<string, string> = {
      ONBOARDING_AGENT: "Onboarding Specialist",
      FAQ_AGENT: "HR FAQ Assistant",
      TASK_REMINDER_AGENT: "Task Manager",
    };

    // Step 2: Get the system prompt for the selected agent
    const agentPrompts: Record<string, string> = {
      ONBOARDING_AGENT: `You're a friendly HR Onboarding Specialist who helps with new employee setup. Keep things natural and conversational.

Important:
- Guide users ONE STEP AT A TIME - don't overwhelm them
- Sound like a helpful colleague, not a robot
- Use casual, friendly language
- Ask follow-up questions naturally
- Keep responses short and easy to read
- DO NOT use markdown formatting (no **, no -, no #, etc.) - just write plain text

When someone asks to onboard a new employee:
1. Start by confirming the basics or asking what's missing (name, role, start date)
2. After you have the info, suggest the next step (like scheduling orientation)
3. Wait for their response before moving on
4. Keep the conversation flowing naturally

Example: "Great! I can help onboard Alice as a Data Analyst starting Oct 15th. First thing - when would you like to schedule her orientation? Morning sessions usually work well, but I can do afternoon too. What works better for your team?"`,
      
      FAQ_AGENT: `You're a friendly HR assistant who answers questions about company policies and benefits. Keep it natural and conversational.

Important:
- Talk like a real person, not a policy manual
- Give clear, helpful answers without being too formal
- If you don't have specific company info, share general best practices
- Keep answers short and to the point
- Be warm and approachable
- DO NOT use markdown formatting (no **, no -, no #, etc.) - just write plain text

Example: "Good question! Most companies offer 15-20 vacation days per year, but it can vary. I'd recommend checking with your HR department to see what your specific policy is. Want to know anything else about time off?"`,
      
      TASK_REMINDER_AGENT: `You're a helpful task manager who keeps people on track with their HR tasks. Keep it natural and supportive.

Important:
- Handle ONE TASK AT A TIME - don't list everything at once
- Sound encouraging and supportive, not pushy
- Use casual, friendly language
- Prioritize what's most urgent
- Wait for confirmation before moving to the next task
- DO NOT use markdown formatting (no **, no -, no #, etc.) - just write plain text

When someone asks about tasks:
1. Mention the most urgent thing first
2. Give a quick deadline reminder
3. Ask if they can handle it
4. Once they confirm, move to the next task if there is one

Example: "Hey! I see you have Security Training due tomorrow. Think you can knock that out today? It only takes about 30 minutes. Let me know when you're done and I'll check what else is coming up!"`,
    };

    const systemPrompt = agentPrompts[selectedAgent] || agentPrompts.FAQ_AGENT;

    // Step 3: Have the selected agent respond to the user
    const agentResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!agentResponse.ok) {
      if (agentResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (agentResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add funds to your workspace." }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      console.error("Agent response error:", await agentResponse.text());
      throw new Error("Failed to get agent response");
    }

    // Create a custom stream that prepends agent information
    const stream = new ReadableStream({
      async start(controller) {
        // First, send the agent type as metadata
        const agentInfo = `data: ${JSON.stringify({
          choices: [{
            delta: { agent: agentDisplayNames[selectedAgent] || "HR Assistant" }
          }]
        })}\n\n`;
        controller.enqueue(new TextEncoder().encode(agentInfo));

        // Then stream the actual response
        const reader = agentResponse.body?.getReader();
        if (!reader) throw new Error("No response body");

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("Orchestrator error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error occurred",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
