// Voice message transcription via OpenAI Whisper API
// Accepts OGG/Opus directly — no FFmpeg needed

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";

export async function downloadTwilioMedia(mediaUrl) {
  if (!mediaUrl || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return null;
  }
  const authHeader = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  const response = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${authHeader}` },
  });
  if (!response.ok) {
    console.error("downloadTwilioMedia failed", { status: response.status, mediaUrl });
    return null;
  }
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer);
}

export async function transcribeAudio(audioBuffer, mimeType = "audio/ogg") {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !audioBuffer) return null;

  // Map MIME type to file extension for Whisper
  const extMap = {
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "audio/webm": "webm",
    "audio/x-wav": "wav",
  };
  const ext = extMap[mimeType] || "ogg";
  const filename = `voice.${ext}`;

  // Build multipart form data manually for Whisper API
  const boundary = "----WhisperBoundary" + Date.now();
  const preamble = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${mimeType}`,
    "",
    "",
  ].join("\r\n");
  const modelPart = [
    "",
    `--${boundary}`,
    'Content-Disposition: form-data; name="model"',
    "",
    "whisper-1",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const body = Buffer.concat([
    Buffer.from(preamble),
    audioBuffer,
    Buffer.from(modelPart),
  ]);

  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error("transcribeAudio failed", { status: response.status, error: errorText.slice(0, 300) });
      return null;
    }
    const result = await response.json();
    return (result.text || "").trim();
  } catch (err) {
    console.error("transcribeAudio error:", err.message);
    return null;
  }
}
