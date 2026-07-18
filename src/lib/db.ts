import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { PricedTrip, TripMention, TripSentiment } from "./types.js";

interface TripMentionRow {
  source_id: string;
  channel_id: string;
  destination: string;
  raw_quotes_json: string;
  mention_count: number;
  first_mentioned: string;
  last_mentioned: string;
  participants_json: string;
  status: "dead" | "unclear";
}

interface PricedTripRow extends TripMentionRow {
  nightly_rate: number;
  suggested_nights: number;
  total_cost_per_person: number;
  hotel_name: string;
  booking_url: string;
  updated_at: number;
}

interface TripSentimentRow {
  channel_id: string;
  destination: string;
  username: string;
  sentiment: "positive" | "negative" | "mixed" | "neutral";
  attitude: string;
  preferences_json: string;
  constraints_json: string;
  evidence: string;
  confidence: number;
  updated_at: number;
}

const dbPath = join(process.cwd(), "data", "guilt-trip.sqlite");

mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function normalizeDestination(destination: string) {
  return destination
    .trim()
    .replace(/^the\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.,!?]+$/g, "")
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function buildTripEvidenceSummary(destination: string) {
  return `Trip interest or discussion detected for ${normalizeDestination(destination)}.`;
}

db.exec(`
  DROP TABLE IF EXISTS messages;

  CREATE TABLE IF NOT EXISTS trip_mentions (
    channel_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    destination TEXT NOT NULL,
    raw_quotes_json TEXT NOT NULL,
    mention_count INTEGER NOT NULL,
    first_mentioned TEXT NOT NULL,
    last_mentioned TEXT NOT NULL,
    participants_json TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (channel_id, destination)
  );

  CREATE TABLE IF NOT EXISTS trip_prices (
    channel_id TEXT NOT NULL,
    destination TEXT NOT NULL,
    nightly_rate INTEGER NOT NULL,
    suggested_nights INTEGER NOT NULL,
    total_cost_per_person INTEGER NOT NULL,
    hotel_name TEXT NOT NULL,
    booking_url TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (channel_id, destination),
    FOREIGN KEY (channel_id, destination)
      REFERENCES trip_mentions (channel_id, destination)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS trip_sentiments (
    channel_id TEXT NOT NULL,
    destination TEXT NOT NULL,
    username TEXT NOT NULL,
    sentiment TEXT NOT NULL,
    attitude TEXT NOT NULL,
    preferences_json TEXT NOT NULL,
    constraints_json TEXT NOT NULL,
    evidence TEXT NOT NULL,
    confidence REAL NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (channel_id, destination, username)
  );
`);

const upsertTripMentionStatement = db.prepare(`
  INSERT INTO trip_mentions (
    channel_id,
    source_id,
    destination,
    raw_quotes_json,
    mention_count,
    first_mentioned,
    last_mentioned,
    participants_json,
    status,
    updated_at
  )
  VALUES (
    @channelId,
    @sourceId,
    @destination,
    @rawQuotesJson,
    @mentionCount,
    @firstMentioned,
    @lastMentioned,
    @participantsJson,
    @status,
    @updatedAt
  )
  ON CONFLICT(channel_id, destination) DO UPDATE SET
    source_id = excluded.source_id,
    raw_quotes_json = excluded.raw_quotes_json,
    mention_count = excluded.mention_count,
    first_mentioned = excluded.first_mentioned,
    last_mentioned = excluded.last_mentioned,
    participants_json = excluded.participants_json,
    status = excluded.status,
    updated_at = excluded.updated_at
`);

const getTripMentionsStatement = db.prepare(`
  SELECT source_id, channel_id, destination, raw_quotes_json, mention_count,
    first_mentioned, last_mentioned, participants_json, status
  FROM trip_mentions
  WHERE channel_id = ?
  ORDER BY mention_count DESC, updated_at DESC
`);

const upsertTripPriceStatement = db.prepare(`
  INSERT INTO trip_prices (
    channel_id,
    destination,
    nightly_rate,
    suggested_nights,
    total_cost_per_person,
    hotel_name,
    booking_url,
    updated_at
  )
  VALUES (
    @channelId,
    @destination,
    @nightlyRate,
    @suggestedNights,
    @totalCostPerPerson,
    @hotelName,
    @bookingUrl,
    @updatedAt
  )
  ON CONFLICT(channel_id, destination) DO UPDATE SET
    nightly_rate = excluded.nightly_rate,
    suggested_nights = excluded.suggested_nights,
    total_cost_per_person = excluded.total_cost_per_person,
    hotel_name = excluded.hotel_name,
    booking_url = excluded.booking_url,
    updated_at = excluded.updated_at
`);

const getPricedTripsStatement = db.prepare(`
  SELECT tm.source_id, tm.channel_id, tm.destination, tm.raw_quotes_json,
    tm.mention_count, tm.first_mentioned, tm.last_mentioned,
    tm.participants_json, tm.status, tp.nightly_rate, tp.suggested_nights,
    tp.total_cost_per_person, tp.hotel_name, tp.booking_url, tp.updated_at
  FROM trip_mentions tm
  JOIN trip_prices tp
    ON tp.channel_id = tm.channel_id
    AND tp.destination = tm.destination
  WHERE tm.channel_id = ?
  ORDER BY tm.mention_count DESC, tp.total_cost_per_person ASC
`);

const upsertTripMentionFromSentimentStatement = db.prepare(`
  INSERT INTO trip_mentions (
    channel_id,
    source_id,
    destination,
    raw_quotes_json,
    mention_count,
    first_mentioned,
    last_mentioned,
    participants_json,
    status,
    updated_at
  )
  VALUES (
    @channelId,
    @sourceId,
    @destination,
    @rawQuotesJson,
    1,
    @evidence,
    @evidence,
    @participantsJson,
    'unclear',
    @updatedAt
  )
  ON CONFLICT(channel_id, destination) DO UPDATE SET
    raw_quotes_json = excluded.raw_quotes_json,
    mention_count = trip_mentions.mention_count + 1,
    last_mentioned = excluded.last_mentioned,
    participants_json = excluded.participants_json,
    updated_at = excluded.updated_at
`);

const upsertTripSentimentStatement = db.prepare(`
  INSERT INTO trip_sentiments (
    channel_id,
    destination,
    username,
    sentiment,
    attitude,
    preferences_json,
    constraints_json,
    evidence,
    confidence,
    updated_at
  )
  VALUES (
    @channelId,
    @destination,
    @username,
    @sentiment,
    @attitude,
    @preferencesJson,
    @constraintsJson,
    @evidence,
    @confidence,
    @updatedAt
  )
  ON CONFLICT(channel_id, destination, username) DO UPDATE SET
    sentiment = excluded.sentiment,
    attitude = excluded.attitude,
    preferences_json = excluded.preferences_json,
    constraints_json = excluded.constraints_json,
    evidence = excluded.evidence,
    confidence = excluded.confidence,
    updated_at = excluded.updated_at
`);

const getTripSentimentsStatement = db.prepare(`
  SELECT channel_id, destination, username, sentiment, attitude,
    preferences_json, constraints_json, evidence, confidence, updated_at
  FROM trip_sentiments
  WHERE channel_id = ?
  ORDER BY destination ASC, updated_at DESC
`);

function parseJsonArray(value: string) {
  const parsed: unknown = JSON.parse(value);

  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function rowToTripMention(row: TripMentionRow): TripMention {
  return {
    id: row.source_id,
    destination: normalizeDestination(row.destination),
    rawQuotes: parseJsonArray(row.raw_quotes_json),
    mentionCount: row.mention_count,
    firstMentioned: row.first_mentioned,
    lastMentioned: row.last_mentioned,
    participants: parseJsonArray(row.participants_json),
    status: row.status,
  };
}

function rowToPricedTrip(row: PricedTripRow): PricedTrip {
  return {
    ...rowToTripMention(row),
    nightlyRate: row.nightly_rate,
    suggestedNights: row.suggested_nights,
    totalCostPerPerson: row.total_cost_per_person,
    hotelName: row.hotel_name,
    bookingUrl: row.booking_url,
    priceUpdatedAt: row.updated_at,
  };
}

function rowToTripSentiment(row: TripSentimentRow): TripSentiment {
  return {
    destination: normalizeDestination(row.destination),
    username: row.username,
    sentiment: row.sentiment,
    attitude: row.attitude,
    preferences: parseJsonArray(row.preferences_json),
    constraints: parseJsonArray(row.constraints_json),
    evidenceSummary: row.evidence,
    confidence: row.confidence,
    updatedAt: row.updated_at,
  };
}

export function saveTripMentions(channelId: string, trips: TripMention[]) {
  const updatedAt = Date.now();
  const saveMany = db.transaction((tripMentions: TripMention[]) => {
    tripMentions.forEach((trip) => {
      const destination = normalizeDestination(trip.destination);

      upsertTripMentionStatement.run({
        channelId,
        sourceId: trip.id,
        destination,
        rawQuotesJson: JSON.stringify([buildTripEvidenceSummary(destination)]),
        mentionCount: trip.mentionCount,
        firstMentioned: buildTripEvidenceSummary(destination),
        lastMentioned: buildTripEvidenceSummary(destination),
        participantsJson: JSON.stringify(trip.participants),
        status: trip.status,
        updatedAt,
      });
    });
  });

  saveMany(trips);
}

export function getStoredTripMentions(channelId: string) {
  return (getTripMentionsStatement.all(channelId) as TripMentionRow[]).map(rowToTripMention);
}

export function savePricedTrips(channelId: string, trips: PricedTrip[]) {
  const updatedAt = Date.now();
  const saveMany = db.transaction((pricedTrips: PricedTrip[]) => {
    pricedTrips.forEach((trip) => {
      const destination = normalizeDestination(trip.destination);

      upsertTripPriceStatement.run({
        channelId,
        destination,
        nightlyRate: trip.nightlyRate,
        suggestedNights: trip.suggestedNights,
        totalCostPerPerson: trip.totalCostPerPerson,
        hotelName: trip.hotelName,
        bookingUrl: trip.bookingUrl,
        updatedAt,
      });
    });
  });

  saveMany(trips);
}

export function getStoredPricedTrips(channelId: string) {
  return (getPricedTripsStatement.all(channelId) as PricedTripRow[]).map(rowToPricedTrip);
}

export function saveTripSentiments(
  channelId: string,
  messageId: string,
  sentiments: TripSentiment[],
) {
  const saveMany = db.transaction((tripSentiments: TripSentiment[]) => {
    tripSentiments.forEach((sentiment) => {
      const updatedAt = sentiment.updatedAt || Date.now();
      const destination = normalizeDestination(sentiment.destination);

      upsertTripMentionFromSentimentStatement.run({
        channelId,
        sourceId: `${messageId}:${destination}`,
        destination,
        rawQuotesJson: JSON.stringify([sentiment.evidenceSummary]),
        evidence: sentiment.evidenceSummary,
        participantsJson: JSON.stringify([sentiment.username]),
        updatedAt,
      });

      upsertTripSentimentStatement.run({
        channelId,
        destination,
        username: sentiment.username,
        sentiment: sentiment.sentiment,
        attitude: sentiment.attitude,
        preferencesJson: JSON.stringify(sentiment.preferences),
        constraintsJson: JSON.stringify(sentiment.constraints),
        evidence: sentiment.evidenceSummary,
        confidence: sentiment.confidence,
        updatedAt,
      });
    });
  });

  saveMany(sentiments);
}

export function getStoredTripSentiments(channelId: string) {
  return (getTripSentimentsStatement.all(channelId) as TripSentimentRow[]).map(rowToTripSentiment);
}

export function getDbDebugSnapshot(channelId: string) {
  const tripMentions = getStoredTripMentions(channelId);
  const tripSentiments = getStoredTripSentiments(channelId);
  const tripPrices = getStoredPricedTrips(channelId);

  return {
    counts: {
      tripMentions: tripMentions.length,
      tripSentiments: tripSentiments.length,
      tripPrices: tripPrices.length,
    },
    tripMentions: tripMentions.slice(0, 5),
    tripSentiments: tripSentiments.slice(0, 5),
    tripPrices: tripPrices.slice(0, 5),
  };
}

function migrateNormalizedDestinations() {
  const mentionRows = db.prepare("SELECT * FROM trip_mentions ORDER BY updated_at ASC").all() as Array<
    TripMentionRow & { updated_at: number }
  >;
  const sentimentRows = db.prepare("SELECT * FROM trip_sentiments ORDER BY updated_at ASC").all() as TripSentimentRow[];
  const priceRows = db.prepare("SELECT * FROM trip_prices ORDER BY updated_at ASC").all() as Array<{
    channel_id: string;
    destination: string;
    nightly_rate: number;
    suggested_nights: number;
    total_cost_per_person: number;
    hotel_name: string;
    booking_url: string;
    updated_at: number;
  }>;

  const needsMigration = [...mentionRows, ...sentimentRows, ...priceRows].some(
    (row) => row.destination !== normalizeDestination(row.destination),
  );

  if (!needsMigration) {
    return;
  }

  const migrate = db.transaction(() => {
    db.prepare("DELETE FROM trip_prices").run();
    db.prepare("DELETE FROM trip_sentiments").run();
    db.prepare("DELETE FROM trip_mentions").run();

    mentionRows.forEach((row) => {
      const destination = normalizeDestination(row.destination);

      upsertTripMentionStatement.run({
        channelId: row.channel_id,
        sourceId: row.source_id,
        destination,
        rawQuotesJson: JSON.stringify([buildTripEvidenceSummary(destination)]),
        mentionCount: row.mention_count,
        firstMentioned: buildTripEvidenceSummary(destination),
        lastMentioned: buildTripEvidenceSummary(destination),
        participantsJson: row.participants_json,
        status: row.status,
        updatedAt: row.updated_at,
      });
    });

    sentimentRows.forEach((row) => {
      const destination = normalizeDestination(row.destination);

      upsertTripSentimentStatement.run({
        channelId: row.channel_id,
        destination,
        username: row.username,
        sentiment: row.sentiment,
        attitude: row.attitude,
        preferencesJson: row.preferences_json,
        constraintsJson: row.constraints_json,
        evidence: `User expressed ${row.sentiment} sentiment toward ${destination}.`,
        confidence: row.confidence,
        updatedAt: row.updated_at,
      });
    });

    priceRows.forEach((row) => {
      upsertTripPriceStatement.run({
        channelId: row.channel_id,
        destination: normalizeDestination(row.destination),
        nightlyRate: row.nightly_rate,
        suggestedNights: row.suggested_nights,
        totalCostPerPerson: row.total_cost_per_person,
        hotelName: row.hotel_name,
        bookingUrl: row.booking_url,
        updatedAt: row.updated_at,
      });
    });
  });

  migrate();
}

migrateNormalizedDestinations();
