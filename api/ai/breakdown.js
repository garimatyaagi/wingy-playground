import OpenAI from "openai";

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { title, description = "" } = req.body || {};
    if (!title) {
      return res.status(400).json({ error: "Missing title" });
    }

    // Ensure server has key
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY on server" });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `
Return STRICT JSON only with this exact shape:
{
  "summary": string,
  "steps": [{"text": string, "minutes": number}]
}

Task title: ${title}
Task description: ${description}

Rules:
- 5 to 10 steps
- each step must be actionable (verb-first)
- minutes must be integers between 5 and 180
- no extra text outside JSON
`;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    const text = response.output_text?.trim();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: "AI returned non-JSON output",
        raw: text?.slice?.(0, 500) || "",
      });
    }

    if (!data?.steps || !Array.isArray(data.steps)) {
      return res.status(500).json({ error: "AI returned invalid JSON shape" });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("AI breakdown error:", err);
    return res.status(500).json({ error: "AI breakdown failed" });
  }
}