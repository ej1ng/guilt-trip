import { GoogleGenerativeAI } from "@google/generative-ai";

import type { PricedTrip, SuggestionResult, TripSentiment, TripSuggestion } from "./types.js";

const MODEL_NAME = "gemini-flash-lite-latest";

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

function buildSuggestionPrompt(trips: PricedTrip[], sentiments: TripSentiment[]) {
  const tripPayload = trips.map((trip) => ({
    destination: trip.destination,
    rawQuotes: trip.rawQuotes,
    mentionCount: trip.mentionCount,
    participants: trip.participants,
    hotelName: trip.hotelName,
    suggestedNights: trip.suggestedNights,
    totalCostPerPerson: trip.totalCostPerPerson,
    sentiments: sentiments
      .filter((sentiment) => sentiment.destination === trip.destination)
      .map((sentiment) => ({
        username: sentiment.username,
        sentiment: sentiment.sentiment,
        attitude: sentiment.attitude,
        preferences: sentiment.preferences,
        constraints: sentiment.constraints,
        evidenceSummary: sentiment.evidenceSummary,
        confidence: sentiment.confidence,
      })),
  }));

  return `You are a practical group trip recommender for a Discord bot called Guilt Trip.

Pick which trip the group should actually do based on chat history and pricing.

Return ONLY raw JSON matching this TypeScript shape:

interface SuggestionResult {
  recommendedDestination: string;
  title: string;
  rationale: string;
  rankedTrips: {
    destination: string;
    feasibilityScore: number;
    reason: string;
    nextStep: string;
  }[];
}

Rules:
- Do not include markdown code fences, commentary, or a preamble.
- Rank every input trip from most feasible to least feasible.
- feasibilityScore must be 1-10.
- Favor trips with lower cost per person, more participants, more mentions, clearer enthusiasm, and fewer complaint/preferences conflicts.
- Use sentiments as the primary source for user attitudes, complaints, preferences, timing hints, and blockers.
- Use rawQuotes only as backup evidence if sentiment data is sparse.
- Do not invent prices, hotels, destinations, or quotes.
- Keep rationale under 280 characters.
- Keep each reason and nextStep under 180 characters.
- Tone should be helpful and lightly funny, not mean.

Trips:
${JSON.stringify(tripPayload, null, 2)}`;
}

function normalizeSuggestion(value: unknown, trips: PricedTrip[]): SuggestionResult {
  if (!value || typeof value !== "object") {
    throw new Error("Suggestion response was not a JSON object.");
  }

  const suggestion = value as Partial<SuggestionResult>;

  if (
    typeof suggestion.recommendedDestination !== "string" ||
    typeof suggestion.title !== "string" ||
    typeof suggestion.rationale !== "string" ||
    !Array.isArray(suggestion.rankedTrips)
  ) {
    throw new Error("Suggestion response did not match the expected shape.");
  }

  const fallbackRankings: TripSuggestion[] = [...trips]
    .sort((a, b) => {
      const scoreA = a.mentionCount * 20 - a.totalCostPerPerson;
      const scoreB = b.mentionCount * 20 - b.totalCostPerPerson;

      return scoreB - scoreA;
    })
    .map((trip, index) => ({
      destination: trip.destination,
      feasibilityScore: Math.max(1, 10 - index),
      reason: `${trip.destination} has ${trip.mentionCount} mention${
        trip.mentionCount === 1 ? "" : "s"
      } and prices around $${trip.totalCostPerPerson}/person.`,
      nextStep: `Pick dates for ${trip.suggestedNights} nights and confirm who is actually in.`,
    }));

  const rankedTrips = suggestion.rankedTrips
    .map((trip): TripSuggestion | null => {
      if (
        !trip ||
        typeof trip !== "object" ||
        typeof trip.destination !== "string" ||
        typeof trip.feasibilityScore !== "number" ||
        typeof trip.reason !== "string" ||
        typeof trip.nextStep !== "string"
      ) {
        return null;
      }

      return trip;
    })
    .filter((trip): trip is TripSuggestion => trip !== null);

  return {
    recommendedDestination:
      suggestion.recommendedDestination.trim() || fallbackRankings[0]?.destination || trips[0].destination,
    title: suggestion.title.trim() || "Most feasible trip",
    rationale: suggestion.rationale.trim(),
    rankedTrips: rankedTrips.length > 0 ? rankedTrips : fallbackRankings,
  };
}

export async function generateSuggestion(
  trips: PricedTrip[],
  sentiments: TripSentiment[] = [],
): Promise<SuggestionResult> {
  const apiKey = requireEnv("GEMINI_API_KEY");
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });
  const result = await model.generateContent(buildSuggestionPrompt(trips, sentiments));
  const rawText = result.response.text();
  const cleanedText = stripJsonCodeFence(rawText);

  try {
    const parsed: unknown = JSON.parse(cleanedText);

    return normalizeSuggestion(parsed, trips);
  } catch (error) {
    throw new Error(`Failed to parse Gemini suggestion JSON. Raw response: ${rawText}`, {
      cause: error,
    });
  }
}
