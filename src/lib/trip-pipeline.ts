import type { ChatInputCommandInteraction } from "discord.js";

import { getChannelTranscript } from "./channel-history.js";
import {
  getStoredPricedTrips,
  getStoredTripSentiments,
  getStoredTripMentions,
  savePricedTrips,
  saveTripMentions,
} from "./db.js";
import { parseTrips } from "./parse-trips.js";
import { priceTrips } from "./price-trips.js";
import { sortTripsByPreference } from "./trip-display.js";
import type { PricedTrip, TripMention, TripSentiment } from "./types.js";

const PRICE_STALE_MS = 24 * 60 * 60 * 1000;

function mergeTrips(storedTrips: TripMention[], parsedTrips: TripMention[]) {
  const tripsByDestination = new Map<string, TripMention>();

  storedTrips.forEach((trip) => {
    tripsByDestination.set(trip.destination.toLowerCase(), trip);
  });

  parsedTrips.forEach((trip) => {
    const key = trip.destination.toLowerCase();
    const existingTrip = tripsByDestination.get(key);

    if (!existingTrip) {
      tripsByDestination.set(key, trip);
      return;
    }

    tripsByDestination.set(key, {
      ...existingTrip,
      rawQuotes: [...new Set([...existingTrip.rawQuotes, ...trip.rawQuotes])],
      mentionCount: Math.max(existingTrip.mentionCount, trip.mentionCount),
      participants: [...new Set([...existingTrip.participants, ...trip.participants])],
      status: existingTrip.status === "dead" || trip.status === "dead" ? "dead" : "unclear",
    });
  });

  return [...tripsByDestination.values()];
}

export interface TripPipelineResult {
  transcript: string;
  trips: TripMention[];
  pendingTrips: TripMention[];
  deadTrips: TripMention[];
  unclearTrips: TripMention[];
  pricedTrips: PricedTrip[];
  sentiments: TripSentiment[];
  usedStoredTrips: boolean;
  usedStoredPrices: boolean;
}

export async function getTripPipelineResult(
  interaction: ChatInputCommandInteraction,
): Promise<TripPipelineResult> {
  const channelId = interaction.channelId;
  const transcript = await getChannelTranscript(interaction);
  let trips = getStoredTripMentions(channelId);
  let usedStoredTrips = trips.length > 0;
  const sentiments = getStoredTripSentiments(channelId);

  if (transcript) {
    const parsedTrips = await parseTrips(transcript);

    if (parsedTrips.length > 0) {
      trips = mergeTrips(trips, parsedTrips);
      saveTripMentions(channelId, trips);
    }
  }

  const deadTrips = sortTripsByPreference(
    trips.filter((trip) => trip.status === "dead"),
    sentiments,
  );
  const unclearTrips = sortTripsByPreference(
    trips.filter((trip) => trip.status === "unclear"),
    sentiments,
  );
  const pendingTrips = sortTripsByPreference(
    trips.filter((trip) => trip.status === "dead" || trip.status === "unclear"),
    sentiments,
  );

  let pricedTrips = getStoredPricedTrips(channelId);
  const usedStoredPrices = pricedTrips.length > 0;

  if (pendingTrips.length > 0) {
    const now = Date.now();
    const pricedTripsByDestination = new Map(
      pricedTrips.map((trip) => [trip.destination, trip]),
    );
    const tripsNeedingPrices = pendingTrips.filter((trip) => {
      const pricedTrip = pricedTripsByDestination.get(trip.destination);

      return (
        !pricedTrip ||
        !pricedTrip.priceUpdatedAt ||
        now - pricedTrip.priceUpdatedAt > PRICE_STALE_MS
      );
    });

    if (tripsNeedingPrices.length > 0) {
      const refreshedTrips = await priceTrips(tripsNeedingPrices);
      savePricedTrips(channelId, refreshedTrips);
      pricedTrips = getStoredPricedTrips(channelId);
    }
  }

  pricedTrips = sortTripsByPreference(pricedTrips, sentiments);

  return {
    transcript,
    trips: sortTripsByPreference(trips, sentiments),
    pendingTrips,
    deadTrips,
    unclearTrips,
    pricedTrips,
    sentiments,
    usedStoredTrips,
    usedStoredPrices,
  };
}

export async function getSuggestionPipelineResult(
  interaction: ChatInputCommandInteraction,
): Promise<TripPipelineResult> {
  const result = await getTripPipelineResult(interaction);

  if (result.pricedTrips.length > 0 || result.trips.length === 0) {
    return result;
  }

  const tripLeads = result.trips.filter(
    (trip) => trip.status === "dead" || trip.status === "unclear",
  );
  const pricedTrips = await priceTrips(tripLeads);

  savePricedTrips(interaction.channelId, pricedTrips);

  return {
    ...result,
    pricedTrips,
    usedStoredPrices: false,
  };
}
