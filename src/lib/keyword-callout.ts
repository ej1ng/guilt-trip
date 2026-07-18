import type { Message } from "discord.js";

import { priceTrips } from "./price-trips.js";
import type { KeywordTrigger } from "./keyword-tracker.js";
import type { PricedTrip, TripMention } from "./types.js";

const DEFAULT_DESTINATION = "Montreal";
const FALLBACK_HOTEL_NAME = "a hotel in Montreal";
const FALLBACK_NIGHTLY_RATE = 240;
const FALLBACK_BOOKING_URL = "https://www.stay22.com/";

let cachedDefaultTrip: PricedTrip | null = null;

function buildDefaultTripMention(): TripMention {
  return {
    id: "default-montreal-keyword-callout",
    destination: DEFAULT_DESTINATION,
    rawQuotes: ["ambient spending detector"],
    mentionCount: 1,
    firstMentioned: "keyword callout",
    lastMentioned: "keyword callout",
    participants: ["the group", "the group chat"],
    status: "dead",
  };
}

async function getDefaultPricedTrip() {
  if (cachedDefaultTrip) {
    return cachedDefaultTrip;
  }

  try {
    const [pricedTrip] = await priceTrips([buildDefaultTripMention()]);

    if (pricedTrip) {
      cachedDefaultTrip = pricedTrip;
      return pricedTrip;
    }
  } catch (error) {
    console.warn("Failed to price default keyword callout destination:", error);
  }

  return {
    ...buildDefaultTripMention(),
    nightlyRate: FALLBACK_NIGHTLY_RATE,
    suggestedNights: 1,
    totalCostPerPerson: FALLBACK_NIGHTLY_RATE,
    hotelName: FALLBACK_HOTEL_NAME,
    bookingUrl: FALLBACK_BOOKING_URL,
  };
}

function formatNightsTowardTrip(totalSpend: number, nightlyRate: number) {
  const nights = totalSpend / nightlyRate;

  if (nights >= 1) {
    return `${nights.toFixed(1)} night${nights >= 2 ? "s" : ""}`;
  }

  const percent = Math.round(nights * 100);

  return `${percent}% of a night`;
}

export async function sendKeywordCallout(message: Message, trigger: KeywordTrigger) {
  if (!("send" in message.channel)) {
    return;
  }

  const pricedTrip = await getDefaultPricedTrip();
  const nightsText = formatNightsTowardTrip(trigger.totalSpend, pricedTrip.nightlyRate);

  await message.channel.send(
    `That's the ${trigger.count}th time ${trigger.keyword} came up this week. At $${trigger.estimatedCost} a pop, that's $${trigger.totalSpend} — about ${nightsText} at [${pricedTrip.hotelName}](${pricedTrip.bookingUrl}) in ${pricedTrip.destination} (~$${pricedTrip.nightlyRate}/night).`,
  );
}
