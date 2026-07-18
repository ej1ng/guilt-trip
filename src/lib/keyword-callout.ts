import type { Message } from "discord.js";

import {
  getStoredPricedTrips,
  getStoredTripMentions,
  savePricedTrips,
} from "./db.js";
import { priceTrips } from "./price-trips.js";
import type { KeywordTrigger } from "./keyword-tracker.js";
import type { PricedTrip, TripMention } from "./types.js";

const DEFAULT_DESTINATION = "Montreal";
const FALLBACK_HOTEL_NAME = "a hotel in Montreal";
const FALLBACK_NIGHTLY_RATE = 240;
const FALLBACK_BOOKING_URL = "https://www.stay22.com/";
const RANDOM_FALLBACK_DESTINATIONS = ["Montreal", "Miami", "Chicago", "New Orleans"];

let cachedFallbackTrip: PricedTrip | null = null;

function pickRandomItem<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function buildDefaultTripMention(destination = DEFAULT_DESTINATION): TripMention {
  return {
    id: `default-${destination.toLowerCase().replace(/\s+/g, "-")}-keyword-callout`,
    destination,
    rawQuotes: ["ambient spending detector"],
    mentionCount: 1,
    firstMentioned: "keyword callout",
    lastMentioned: "keyword callout",
    participants: ["the group", "the group chat"],
    status: "dead",
  };
}

async function getFallbackPricedTrip() {
  if (cachedFallbackTrip) {
    return cachedFallbackTrip;
  }

  const fallbackDestination = pickRandomItem(RANDOM_FALLBACK_DESTINATIONS) ?? DEFAULT_DESTINATION;

  try {
    const [pricedTrip] = await priceTrips([buildDefaultTripMention(fallbackDestination)]);

    if (pricedTrip) {
      cachedFallbackTrip = pricedTrip;
      return pricedTrip;
    }
  } catch (error) {
    console.warn("Failed to price fallback keyword callout destination:", error);
  }

  return {
    ...buildDefaultTripMention(DEFAULT_DESTINATION),
    nightlyRate: FALLBACK_NIGHTLY_RATE,
    suggestedNights: 1,
    totalCostPerPerson: FALLBACK_NIGHTLY_RATE,
    hotelName: FALLBACK_HOTEL_NAME,
    bookingUrl: FALLBACK_BOOKING_URL,
  };
}

async function getKeywordCalloutPricedTrip(channelId: string) {
  const storedPricedTrips = getStoredPricedTrips(channelId);
  const storedPricedTrip = pickRandomItem(storedPricedTrips);

  if (storedPricedTrip) {
    return storedPricedTrip;
  }

  const storedTripMentions = getStoredTripMentions(channelId);
  const storedTripMention = pickRandomItem(storedTripMentions);

  if (storedTripMention) {
    const [pricedTrip] = await priceTrips([storedTripMention]);

    if (pricedTrip) {
      savePricedTrips(channelId, [pricedTrip]);
      return pricedTrip;
    }
  }

  return getFallbackPricedTrip();
}

function formatNightsTowardTrip(totalSpend: number, nightlyRate: number) {
  const nights = totalSpend / nightlyRate;

  if (nights >= 1) {
    return `${nights.toFixed(1)} night${nights >= 2 ? "s" : ""}`;
  }

  const percent = Math.round(nights * 100);

  return `${percent}% of a night`;
}

function buildKeywordRoast(keyword: string, username: string) {
  const normalizedKeyword = keyword.toLowerCase();

  if (
    ["brunch", "doordash", "takeout", "boba", "coffee", "go out for dinner", "dinner"].includes(
      normalizedKeyword,
    )
  ) {
    return `${username}, you absolute chud, ${keyword} came up again like your bank account is not already begging for mercy.`;
  }

  if (normalizedKeyword === "retail therapy") {
    return `${username}, calling it ${keyword} does not make the credit card damage inspirational.`;
  }

  if (normalizedKeyword === "shopping") {
    return `${username}, another shopping mention? The trip fund just watched a tote bag get priority boarding.`;
  }

  if (normalizedKeyword === "uber") {
    return `${username}, another Uber mention? Chud-level commitment to avoiding a normal sidewalk.`;
  }

  if (["drink", "drinks", "happy hour"].includes(normalizedKeyword)) {
    return `${username}, this ${keyword} habit is giving main-character wannabe.`;
  }

  if (["concert", "movie"].includes(normalizedKeyword)) {
    return `${username}, this ${keyword} habit is really committed to keeping the group chat unbooked.`;
  }

  return `${username}, ${keyword} has entered the evidence folder. The trip fund remains unimpressed.`;
}

function formatCostUnit(keyword: string, estimatedCost: number) {
  const normalizedKeyword = keyword.toLowerCase();

  if (["shopping", "retail therapy"].includes(normalizedKeyword)) {
    return `assuming $${estimatedCost} per retail spiral`;
  }

  if (normalizedKeyword === "uber") {
    return `assuming $${estimatedCost} per ride`;
  }

  if (["brunch", "go out for dinner", "dinner"].includes(normalizedKeyword)) {
    return `assuming $${estimatedCost} per meal`;
  }

  if (["doordash", "takeout"].includes(normalizedKeyword)) {
    return `assuming $${estimatedCost} per lazy little food delivery`;
  }

  if (["coffee", "boba"].includes(normalizedKeyword)) {
    return `assuming $${estimatedCost} per drink`;
  }

  if (["drink", "drinks", "happy hour"].includes(normalizedKeyword)) {
    return `assuming $${estimatedCost} per round`;
  }

  if (normalizedKeyword === "concert") {
    return `assuming $${estimatedCost} per ticket`;
  }

  if (normalizedKeyword === "movie") {
    return `assuming $${estimatedCost} per ticket and snack tax`;
  }

  return `assuming $${estimatedCost} each time`;
}

export async function sendKeywordCallout(message: Message, trigger: KeywordTrigger) {
  if (!("send" in message.channel)) {
    return;
  }

  const pricedTrip = await getKeywordCalloutPricedTrip(message.channelId);
  const nightsText = formatNightsTowardTrip(trigger.totalSpend, pricedTrip.nightlyRate);
  const roast = buildKeywordRoast(trigger.keyword, message.author.username);
  const costUnit = formatCostUnit(trigger.keyword, trigger.estimatedCost);
  const spendContext =
    trigger.kind === "plan-confirmed"
      ? `${trigger.keyword} is somehow making it out of the group chat but not your vacas; ${costUnit}, that's $${trigger.totalSpend}`
      : `That's the ${trigger.count}th time ${trigger.keyword} came up this week; ${costUnit}, that's $${trigger.totalSpend}`;

  await message.channel.send(
    `${roast} ${spendContext} — about ${nightsText} at [${pricedTrip.hotelName}](${pricedTrip.bookingUrl}) in ${pricedTrip.destination} (~$${pricedTrip.nightlyRate}/night).`,
  );
}
