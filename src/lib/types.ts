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
}

export interface RoastResult {
  trips: PricedTrip[];
  totalWastedPotential: number;
  headline: string;
  roastLines: string[];
  closingLine: string;
}
