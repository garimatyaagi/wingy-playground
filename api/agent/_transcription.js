// Voice message transcription via OpenAI Whisper API
// Accepts OGG/Opus directly — no FFmpeg needed

import OpenAI from "openai";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";

export async function downloadTwilioMedia(mediaUrl) {
  if (!mediaUrl || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.error("downloadTwilioMedia: missing credentials or URL", {
      hasUrl: Boolean(mediaUrl),
      hasSid: Boolean(TWILIO_ACCOUNT_SID),
      hasToken: Boolean(TWILIO_AUTH_TOKEN),
    });
    return null;
  }
  const authHeader = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  // Twilio media URLs may redirect — follow them
  const response = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${authHeader}` },
    redirect: "follow",
  });
  if (!response.ok) {
    console.error("downloadTwilioMedia failed", { status: response.status, mediaUrl });
    return null;
  }
  const buffer = await response.arrayBuffer();
  console.log("downloadTwilioMedia success", { bytes: buffer.byteLength, mediaUrl: mediaUrl.slice(0, 80) });
  return Buffer.from(buffer);
}

export async function transcribeAudio(audioBuffer, mimeType = "audio/ogg") {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !audioBuffer || audioBuffer.length === 0) {
    console.error("transcribeAudio: missing API key or empty buffer", {
      hasKey: Boolean(apiKey),
      bufferLen: audioBuffer?.length || 0,
    });
    return null;
  }

  // Map MIME type to file extension for Whisper
  const extMap = {
    "audio/ogg": "ogg",
    "audio/ogg; codecs=opus": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "audio/webm": "webm",
    "audio/x-wav": "wav",
    "audio/amr": "amr",
  };
  // Handle mimeType with parameters (e.g., "audio/ogg; codecs=opus")
  const baseMime = mimeType.split(";")[0].trim();
  const ext = extMap[mimeType] || extMap[baseMime] || "ogg";
  const filename = `voice.${ext}`;

  try {
    const client = new OpenAI({ apiKey });
    // Use the OpenAI SDK's file upload — handles multipart correctly
    // toFile from the SDK handles Buffer → uploadable file conversion
    const { toFile } = await import("openai/uploads");
    const file = await toFile(audioBuffer, filename, { type: baseMime });
    const result = await client.audio.transcriptions.create({
      model: "whisper-1",
      file,
    });
    const text = (result.text || "").trim();
    console.log("transcribeAudio success", { text: text.slice(0, 100), mimeType, bytes: audioBuffer.length });
    return text || null;
  } catch (err) {
    console.error("transcribeAudio error:", err.message, err.status, JSON.stringify(err.error || {}).slice(0, 300));
    return null;
  }
}
