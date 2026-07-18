import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Message } from "discord.js";

import { getStoredTripMentions, saveTripSentiments } from "./db.js";
import type { TripSentiment } from "./types.js";

const MODEL_NAME = "gemini-flash-lite-latest";

const TRAVEL_SIGNAL_PATTERNS = [
  /\btrip(s)?\b/i,
  /\btravel(ing)?\b/i,
  /\bvacation\b/i,
  /\bflight(s)?\b/i,
  /\bhotel(s)?\b/i,
  /\bairbnb\b/i,
  /\bresort\b/i,
  /\bbeach\b/i,
  /\bcamping\b/i,
  /\bcabin\b/i,
  /\bweekend\b/i,
  /\bbook(ing|ed)?\b/i,
  /\bvisit(ing)?\b/i,
  /\bgo to\b/i,
  /\bgoto\b/i,
  /\bwanna\s+go\s+to\b/i,
  /\bwant\s+to\s+go\s+to\b/i,
  /\bdown for\b/i,
  /\bgrad\s*trip\b/i,
];

const ATTITUDE_SIGNAL_PATTERNS = [
  /\btoo expensive\b/i,
  /\bcheap\b/i,
  /\bbudget\b/i,
  /\bcan't go\b/i,
  /\bcannot go\b/i,
  /\bnot down\b/i,
  /\bi'?m down\b/i,
  /\bsounds fun\b/i,
  /\bno thanks\b/i,
  /\btoo far\b/i,
  /\bdates?\b/i,
  /\bjune\b/i,
  /\bjuly\b/i,
  /\baugust\b/i,
  /\bsummer\b/i,
  /\bwinter\b/i,
];

const COMMON_DESTINATION_PATTERNS = [
  /\bkorea\b/i,
  /\bsouth korea\b/i,
  /\bjapan\b/i,
  /\btokyo\b/i,
  /\bbahamas\b/i,
  /\bmexico\b/i,
  /\bcanada\b/i,
  /\bmontreal\b/i,
  /\bmiami\b/i,
  /\bchicago\b/i,
  /\bnew york\b/i,
  /\bla\b/i,
  /\blos angeles\b/i,
  /\bparis\b/i,
  /\blondon\b/i,
  /\bitaly\b/i,
  /\bgreece\b/i,
  /\bhawaii\b/i,
];

interface SentimentObservation {
  destination: string;
  sentiment: "positive" | "negative" | "mixed" | "neutral";
  attitude: string;
  preferences: string[];
  constraints: string[];
  evidenceSummary: string;
  confidence: number;
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

function mentionsKnownDestination(channelId: string, content: string) {
  const normalizedContent = content.toLowerCase();

  return getStoredTripMentions(channelId).some((trip) =>
    normalizedContent.includes(trip.destination.toLowerCase()),
  );
}

function looksLikeStandalonePlaceOrTripIdea(content: string) {
  const trimmed = content.trim();
  const words = trimmed.split(/\s+/);

  if (words.length > 4 || trimmed.length < 3 || /https?:\/\//i.test(trimmed)) {
    return false;
  }

  const hasCapitalizedWord = words.some((word) => /^[A-Z][a-zA-Z'.-]+[?!.,]?$/.test(word));
  const hasQuestionMark = trimmed.endsWith("?");
  const hasTripTypeWord = /\b(beach|camping|cabin|ski|roadtrip|road trip)\b/i.test(trimmed);

  return hasCapitalizedWord || hasQuestionMark || hasTripTypeWord;
}

function shouldAnalyzeMessage(message: Message) {
  const content = message.content.trim();

  if (message.author.bot || content.length === 0) {
    return false;
  }

  return (
    TRAVEL_SIGNAL_PATTERNS.some((pattern) => pattern.test(content)) ||
    ATTITUDE_SIGNAL_PATTERNS.some((pattern) => pattern.test(content)) ||
    COMMON_DESTINATION_PATTERNS.some((pattern) => pattern.test(content)) ||
    mentionsKnownDestination(message.channelId, content) ||
    looksLikeStandalonePlaceOrTripIdea(content)
  );
}

function buildSentimentPrompt(message: Message) {
  return `You are the same trip-detection logic used by Guilt Trip's /guilttrip command, but applied to ONE new Discord message at a time.

Decide whether this message contains a trip/destination mention, a trip preference, a complaint/blocker about a trip, or a change in attitude toward a trip.

Return ONLY raw JSON matching this TypeScript shape:

type SentimentObservation = {
  destination: string;
  sentiment: "positive" | "negative" | "mixed" | "neutral";
  attitude: string;
  preferences: string[];
  constraints: string[];
  evidenceSummary: string;
  confidence: number;
};

Rules:
- Return a JSON array of SentimentObservation objects.
- Return [] if the message is not trip-related.
- Treat standalone destinations or trip types as trip signals when they plausibly refer to travel in chat, e.g. "Bahamas", "camping", "beach trip", "Montreal".
- Extract distinct destinations/trip types mentioned in this one message.
- destination should be the concrete place/trip type mentioned, like "Bahamas", "camping", "Montreal", or "beach trip".
- sentiment should capture the author's attitude toward that trip/destination.
- Use "neutral" for bare mentions like "Bahamas" where there is no clear opinion yet.
- preferences are things the author wants, like "beach", "cheap", "warm", "short flight".
- constraints are complaints/blockers, like "too expensive", "can't do June", "not camping".
- evidenceSummary must summarize the relevant evidence without quoting the user's message verbatim.
- Keep evidenceSummary under 100 characters.
- confidence must be 0-1.
- Do not include markdown fences or commentary.

Author: ${message.author.username}
Message: ${message.content}`;
}

function normalizeObservations(value: unknown, message: Message): TripSentiment[] {
  if (!Array.isArray(value)) {
    throw new Error("Sentiment response was not a JSON array.");
  }

  return value
    .map((item): TripSentiment | null => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const observation = item as Partial<SentimentObservation>;

      if (
        typeof observation.destination !== "string" ||
        typeof observation.sentiment !== "string" ||
        typeof observation.attitude !== "string" ||
        typeof observation.evidenceSummary !== "string"
      ) {
        return null;
      }

      const sentiment = observation.sentiment;

      if (!["positive", "negative", "mixed", "neutral"].includes(sentiment)) {
        return null;
      }

      return {
        destination: observation.destination.trim(),
        username: message.author.username,
        sentiment,
        attitude: observation.attitude.trim(),
        preferences: Array.isArray(observation.preferences)
          ? observation.preferences.map(String)
          : [],
        constraints: Array.isArray(observation.constraints)
          ? observation.constraints.map(String)
          : [],
        evidenceSummary: observation.evidenceSummary.trim(),
        confidence:
          typeof observation.confidence === "number"
            ? Math.min(1, Math.max(0, observation.confidence))
            : 0.5,
        updatedAt: message.createdTimestamp,
      };
    })
    .filter((observation): observation is TripSentiment => observation !== null)
    .filter((observation) => observation.destination.length > 0);
}

export async function analyzeAndStoreMessageSentiment(message: Message) {
  if (!shouldAnalyzeMessage(message)) {
    return;
  }

  const apiKey = requireEnv("GEMINI_API_KEY");
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });
  const result = await model.generateContent(buildSentimentPrompt(message));
  const rawText = result.response.text();
  const cleanedText = stripJsonCodeFence(rawText);

  try {
    const parsed: unknown = JSON.parse(cleanedText);
    const observations = normalizeObservations(parsed, message);

    if (observations.length > 0) {
      saveTripSentiments(message.channelId, message.id, observations);
    }
  } catch (error) {
    throw new Error(`Failed to parse Gemini sentiment JSON. Raw response: ${rawText}`, {
      cause: error,
    });
  }
}
