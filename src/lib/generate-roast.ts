import { GoogleGenerativeAI } from "@google/generative-ai";

import { getSafeHotelName } from "./trip-display.js";
import type { PricedTrip, RoastResult } from "./types.js";

const MODEL_NAME = "gemini-flash-lite-latest";

interface RoastCopy {
  headline: string;
  roastLines: string[];
  closingLine: string;
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

function buildRoastPrompt(trips: PricedTrip[]) {
  const tripPayload = trips.map((trip) => ({
    destination: trip.destination,
    rawQuotes: trip.rawQuotes,
    mentionCount: trip.mentionCount,
    participants: trip.participants,
    hotelName: getSafeHotelName(trip),
    nightlyRate: trip.nightlyRate,
    suggestedNights: trip.suggestedNights,
    totalCostPerPerson: trip.totalCostPerPerson,
  }));

  return `You write short Discord copy for a bot called Guilt Trip.

Tone: friend-roasting-a-friend, deadpan case-file energy, funny but never mean-spirited, never generic corporate.

Return ONLY raw JSON matching this TypeScript shape:

interface RoastCopy {
  headline: string;
  roastLines: string[];
  closingLine: string;
}

Rules:
- Do not include markdown code fences, commentary, or a preamble.
- headline should be a short stat-driven title about pending trip evidence.
- roastLines must contain exactly one line per trip, in the same order as the input trips.
- Each roastLine must reference a real quote or quote fragment from rawQuotes and the real cost per person.
- Keep each roastLine under 220 characters.
- closingLine should pivot toward "so are we doing this or not" and reference the most-mentioned trip.
- Do not invent prices, hotels, destinations, quotes, or participants.
- Do not make romantic, dating, sexual, couple, or relationship insinuations.
- Do not riff on hotel names that contain words like "Love", "Romance", "Couple", or similar; treat hotel names neutrally.
- Do not imply participants are dating, hooking up, in love, a couple, or romantically involved.

Priced trips:
${JSON.stringify(tripPayload, null, 2)}`;
}

function removeRomanticInsinuations(text: string, trip: PricedTrip) {
  if (
    !/\b(in love|actually in love|dating|date night|couple|couples|romance|romantic|hooking up|honeymoon|situationship|soulmate|lovers?)\b/i.test(
      text,
    )
  ) {
    return text;
  }

  return `${trip.destination}: about $${trip.totalCostPerPerson}/person to turn the group chat from "we should go" into "we actually booked it."`;
}

function normalizeRoastCopy(value: unknown, trips: PricedTrip[]): RoastCopy {
  if (!value || typeof value !== "object") {
    throw new Error("Roast response was not a JSON object.");
  }

  const roast = value as Partial<RoastCopy>;

  if (
    typeof roast.headline !== "string" ||
    !Array.isArray(roast.roastLines) ||
    typeof roast.closingLine !== "string"
  ) {
    throw new Error("Roast response did not match the expected shape.");
  }

  const roastLines = trips.map((trip, index) => {
    const line = roast.roastLines?.[index];

    if (typeof line === "string" && line.trim().length > 0) {
      return removeRomanticInsinuations(line.trim(), trip);
    }

    return `${trip.destination}: all that talk and it is currently about $${trip.totalCostPerPerson}/person to stop making it a group chat ghost story.`;
  });

  return {
    headline: roast.headline.trim(),
    roastLines,
    closingLine: roast.closingLine.trim(),
  };
}

export async function generateRoast(trips: PricedTrip[]): Promise<RoastResult> {
  const apiKey = requireEnv("GEMINI_API_KEY");
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });
  const result = await model.generateContent(buildRoastPrompt(trips));
  const rawText = result.response.text();
  const cleanedText = stripJsonCodeFence(rawText);

  try {
    const parsed: unknown = JSON.parse(cleanedText);
    const roast = normalizeRoastCopy(parsed, trips);

    return {
      trips,
      totalWastedPotential: trips.reduce((total, trip) => total + trip.totalCostPerPerson, 0),
      headline: roast.headline,
      roastLines: roast.roastLines,
      closingLine: roast.closingLine,
    };
  } catch (error) {
    throw new Error(`Failed to parse Gemini roast JSON. Raw response: ${rawText}`, {
      cause: error,
    });
  }
}
