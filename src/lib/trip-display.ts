import type { PricedTrip, TripMention, TripSentiment } from "./types.js";

const ROMANTIC_HOTEL_PATTERN =
  /\b(love|romance|romantic|couple|couples|honeymoon|lover|lovers|sweetheart)\b/i;

export function getSafeHotelName(trip: PricedTrip) {
  if (ROMANTIC_HOTEL_PATTERN.test(trip.hotelName)) {
    return `a hotel in ${trip.destination}`;
  }

  return trip.hotelName;
}

export function getTripSentimentScore(destination: string, sentiments: TripSentiment[]) {
  return sentiments
    .filter((sentiment) => sentiment.destination.toLowerCase() === destination.toLowerCase())
    .reduce((score, sentiment) => {
      const confidence = sentiment.confidence || 0.5;

      if (sentiment.sentiment === "positive") {
        return score + 2 * confidence;
      }

      if (sentiment.sentiment === "mixed") {
        return score + 0.5 * confidence;
      }

      if (sentiment.sentiment === "negative") {
        return score - 2 * confidence;
      }

      return score;
    }, 0);
}

export function sortTripsByPreference<T extends TripMention>(
  trips: T[],
  sentiments: TripSentiment[],
) {
  return [...trips].sort((a, b) => {
    const sentimentDelta =
      getTripSentimentScore(b.destination, sentiments) -
      getTripSentimentScore(a.destination, sentiments);

    if (sentimentDelta !== 0) {
      return sentimentDelta;
    }

    return b.mentionCount - a.mentionCount;
  });
}
