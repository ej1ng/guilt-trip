import { GoogleGenerativeAI } from "@google/generative-ai";

import type { TripMention } from "./types.js";

const MODEL_NAME = "gemini-flash-lite-latest";

export class GeminiQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiQuotaError";
  }
}

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function stripJsonCodeFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function buildExtractionPrompt(transcript: string) {
  return `You extract abandoned trip ideas from Discord chat transcripts.

Return ONLY raw JSON matching this TypeScript shape:

interface TripMention {
  id: string;
  destination: string;
  rawQuotes: string[];
  mentionCount: number;
  firstMentioned: string;
  lastMentioned: string;
  participants: string[];
  status: "dead" | "unclear";
}

Rules:
- Return a JSON array of TripMention objects.
- Do not include markdown code fences, commentary, or a preamble.
- Identify distinct trip or destination mentions from the transcript.
- Include short exact quoted lines in rawQuotes.
- mentionCount should estimate how often the destination/trip was discussed.
- participants should be unique usernames who engaged with that trip idea.
- firstMentioned and lastMentioned can be short quote/context labels if timestamps are unavailable.
- If there is evidence the trip was actually booked, exclude it from the array.
- Use status "dead" when people discussed, suggested, wished for, or lightly planned a trip/destination and there is no explicit evidence it was booked.
- Use status "unclear" only when it is ambiguous whether the chat is about a real trip idea at all.
- For this hackathon demo, bias toward finding plausible abandoned trip ideas instead of returning [].
- If no abandoned trip ideas are present, return [].

Transcript:
${transcript}`;
}

function isGeminiQuotaError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const status = "status" in error ? error.status : undefined;

  return status === 429 || /quota|too many requests/i.test(error.message);
}

export async function parseTrips(transcript: string): Promise<TripMention[]> {
  const apiKey = requireEnv("GEMINI_API_KEY");
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  let result;

  try {
    result = await model.generateContent(buildExtractionPrompt(transcript));
  } catch (error) {
    if (isGeminiQuotaError(error)) {
      throw new GeminiQuotaError(
        `Gemini quota is exhausted for ${MODEL_NAME}. Check the API key's Google AI Studio project quota or billing settings.`,
      );
    }

    throw error;
  }

  const rawText = result.response.text();
  const cleanedText = stripJsonCodeFence(rawText);

  try {
    const parsed: unknown = JSON.parse(cleanedText);

    if (!Array.isArray(parsed)) {
      throw new Error("Gemini response was not a JSON array.");
    }

    return parsed as TripMention[];
  } catch (error) {
    throw new Error(
      `Failed to parse Gemini trip extraction JSON. Raw response: ${rawText}`,
      { cause: error },
    );
  }
}
