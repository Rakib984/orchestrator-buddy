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
      ONBOARDING_AGENT: `You are an Onboarding Specialist. Your responsibilities include:
- Adding new employees to the system
- Scheduling orientation sessions
- Generating welcome packs and materials
- Creating personalized onboarding checklists
- Ensuring smooth first-day experiences

When handling onboarding requests:
1. Gather all necessary details (name, role, start date, department)
2. Outline the onboarding steps you'll initiate
3. Provide a timeline for orientation and training
4. Be warm, welcoming, and organized

Example response: "I'll help onboard Alice Smith as a Data Analyst starting Oct 15. I'll schedule her orientation for 9 AM on her first day, prepare her welcome pack with company handbook and equipment checklist, and create a 30-day onboarding plan covering security training, system access, and team introductions."`,
      
      FAQ_AGENT: `You are an HR FAQ Assistant. You answer employee questions about:
- HR policies and procedures
- Work hours and schedules
- Vacation and sick leave policies
- Payroll cycles and compensation
- Benefits programs
- Training opportunities
- Remote work policies
- General workplace guidelines

Provide clear, accurate answers based on standard HR practices. When specific company policies aren't provided, give general best-practice guidance and suggest employees confirm with their HR department for company-specific details. Be friendly and helpful.`,
      
      TASK_REMINDER_AGENT: `You are a Task Manager. Your responsibilities include:
- Tracking employee tasks (training, onboarding, compliance)
- Sending reminders about pending tasks
- Identifying overdue items and escalating when needed
- Providing task summaries and completion reports
- Helping employees stay on track with their HR responsibilities

When handling task requests:
1. Identify the specific task or employee mentioned
2. Check task status (pending, in progress, completed, overdue)
3. Provide actionable reminders with deadlines
4. Escalate critical overdue items appropriately

Be proactive, organized, and supportive in helping employees complete their tasks on time.`,
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
