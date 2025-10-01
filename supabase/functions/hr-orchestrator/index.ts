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

Available sub-agents:
1. BENEFITS_AGENT - Handles questions about health insurance, retirement plans, PTO, wellness programs, and other employee benefits
2. LEAVE_AGENT - Manages vacation requests, sick leave, parental leave, time-off policies, and leave balance inquiries
3. POLICY_AGENT - Answers questions about company policies, procedures, code of conduct, workplace rules, and compliance
4. GENERAL_HR_AGENT - Handles general HR inquiries, onboarding, payroll questions, career development, and anything else

Analyze the user's request and respond with ONLY the agent name (e.g., "BENEFITS_AGENT"). Do not include any other text.`,
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

    // Map agent names to friendly display names
    const agentDisplayNames: Record<string, string> = {
      BENEFITS_AGENT: "Benefits Specialist",
      LEAVE_AGENT: "Leave Manager",
      POLICY_AGENT: "Policy Expert",
      GENERAL_HR_AGENT: "HR Assistant",
    };

    // Step 2: Get the system prompt for the selected agent
    const agentPrompts: Record<string, string> = {
      BENEFITS_AGENT: "You are a Benefits Specialist. Help employees understand their health insurance, retirement plans, PTO, wellness programs, and other benefits. Be clear, helpful, and provide specific information when possible.",
      LEAVE_AGENT: "You are a Leave Manager. Help employees with vacation requests, sick leave, parental leave, and time-off policies. Be supportive and provide clear guidance on procedures.",
      POLICY_AGENT: "You are a Policy Expert. Help employees understand company policies, procedures, code of conduct, and workplace rules. Be precise and cite specific policies when relevant.",
      GENERAL_HR_AGENT: "You are a General HR Assistant. Help employees with onboarding, payroll, career development, and general HR inquiries. Be friendly, professional, and guide them to the right resources.",
    };

    const systemPrompt = agentPrompts[selectedAgent] || agentPrompts.GENERAL_HR_AGENT;

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
