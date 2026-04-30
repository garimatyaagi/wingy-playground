import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// This forces the model to return JSON that matches the schema.
const BreakdownSchema = {
  name: "task_breakdown",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      steps: {
        type: "array",
        minItems: 3,
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: { type: "string" },
            minutes: { type: "integer", minimum: 5, maximum: 180 },
          },
          required: ["text", "minutes"],
        },
      },
    },
    required: ["summary", "steps"],
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { title, description = "", context = "" } = req.body || {};
    if (!title) return res.status(400).json({ error: "Missing title" });
    if (title.length > 500 || description.length > 2000 || context.length > 2000) {
      return res.status(400).json({ error: "Input too long" });
    }
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    const input = [
      {
        role: "system",
        content:
          "You are a sharp execution assistant. Break tasks into actionable steps with realistic time estimates.",
      },
      {
        role: "user",
        content: `Task title: ${title}
Task description: ${description}
Extra context: ${context}

Make a concise summary and a checklist with time estimates.Return JSON only. Do not wrap in triple backticks.`,
      },
    ];

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input,
      // Structured output: the model MUST return valid JSON matching the schema
      text: {
        format: {
          type: "json_schema",
          json_schema: BreakdownSchema,
        },
      },
    });

    // With structured output, output_text should be valid JSON. We can parse safely.
    const text = (response.output_text || "").trim();

function stripCodeFences(s) {
  // Removes ```json ... ``` or ``` ... ```
  return s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

const cleaned = stripCodeFences(text);

let data;
try {
  data = JSON.parse(cleaned);
} catch (e) {
  return res.status(500).json({
    error: "AI returned non-JSON output",
    raw: text.slice(0, 800),
  });
}

return res.status(200).json(data); 
  } catch (err) {
    console.error("breakdown error:", err);
    return res.status(500).json({ error: "AI breakdown failed" });
  }
}