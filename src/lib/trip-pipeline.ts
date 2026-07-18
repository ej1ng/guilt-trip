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
import type { PricedTrip, TripMention, TripSentiment } from "./types.js";

const PRICE_STALE_MS = 24 * 60 * 60 * 1000;

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

  if (trips.length === 0 && transcript) {
    trips = await parseTrips(transcript);
    saveTripMentions(channelId, trips);
  }

  const deadTrips = trips.filter((trip) => trip.status === "dead");
  const unclearTrips = trips.filter((trip) => trip.status === "unclear");
  const pendingTrips = trips.filter(
    (trip) => trip.status === "dead" || trip.status === "unclear",
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

  return {
    transcript,
    trips,
    pendingTrips,
    deadTrips,
    unclearTrips,
    pricedTrips,
    sentiments: getStoredTripSentiments(channelId),
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
