export interface TripMention {
  id: string;
  destination: string;
  rawQuotes: string[];
  mentionCount: number;
  firstMentioned: string;
  lastMentioned: string;
  participants: string[];
  status: "dead" | "unclear";
}

export interface PricedTrip extends TripMention {
  nightlyRate: number;
  suggestedNights: number;
  totalCostPerPerson: number;
  hotelName: string;
  bookingUrl: string;
  priceUpdatedAt?: number;
}

export interface RoastResult {
  trips: PricedTrip[];
  totalWastedPotential: number;
  headline: string;
  roastLines: string[];
  closingLine: string;
}

export interface TripSuggestion {
  destination: string;
  feasibilityScore: number;
  reason: string;
  nextStep: string;
}

export interface SuggestionResult {
  recommendedDestination: string;
  title: string;
  rationale: string;
  rankedTrips: TripSuggestion[];
}

export interface TripSentiment {
  destination: string;
  username: string;
  sentiment: "positive" | "negative" | "mixed" | "neutral";
  attitude: string;
  preferences: string[];
  constraints: string[];
  evidenceSummary: string;
  confidence: number;
  updatedAt: number;
}
