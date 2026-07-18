import type { Message } from "discord.js";

const ROLLING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CHANNEL_COOLDOWN_MS = 10 * 1000;

export interface KeywordTrigger {
  channelId: string;
  keyword: string;
  estimatedCost: number;
  count: number;
  totalSpend: number;
}

interface KeywordConfig {
  keyword: string;
  estimatedCost: number;
  threshold: number;
}

interface KeywordTally {
  mentions: number[];
}

export const TRACKED_KEYWORDS: KeywordConfig[] = [
  { keyword: "brunch", estimatedCost: 25, threshold: 3 },
  { keyword: "shopping", estimatedCost: 60, threshold: 3 },
  { keyword: "uber", estimatedCost: 15, threshold: 3 },
  { keyword: "doordash", estimatedCost: 20, threshold: 3 },
  { keyword: "coffee", estimatedCost: 7, threshold: 3 },
  { keyword: "concert", estimatedCost: 80, threshold: 3 },
];

const tallies = new Map<string, KeywordTally>();
const channelCooldowns = new Map<string, number>();

function getTallyKey(channelId: string, keyword: string) {
  return `${channelId}:${keyword}`;
}

function matchesKeyword(content: string, keyword: string) {
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keywordPattern = new RegExp(`\\b${escapedKeyword}\\b`, "i");

  return keywordPattern.test(content);
}

function pruneOldMentions(mentions: number[], now: number) {
  return mentions.filter((timestamp) => now - timestamp <= ROLLING_WINDOW_MS);
}

function isChannelCoolingDown(channelId: string, now: number) {
  const lastCalloutAt = channelCooldowns.get(channelId);

  return typeof lastCalloutAt === "number" && now - lastCalloutAt < CHANNEL_COOLDOWN_MS;
}

export function trackKeywordMessage(message: Message): KeywordTrigger | null {
  const content = message.content.toLowerCase();
  const now = Date.now();

  if (message.author.bot || content.trim().length === 0) {
    return null;
  }

  for (const config of TRACKED_KEYWORDS) {
    if (!matchesKeyword(content, config.keyword)) {
      continue;
    }

    const tallyKey = getTallyKey(message.channelId, config.keyword);
    const tally = tallies.get(tallyKey) ?? { mentions: [] };
    const mentions = [...pruneOldMentions(tally.mentions, now), now];

    tallies.set(tallyKey, { mentions });

    if (mentions.length < config.threshold || isChannelCoolingDown(message.channelId, now)) {
      continue;
    }

    tallies.set(tallyKey, { mentions: [] });
    channelCooldowns.set(message.channelId, now);

    return {
      channelId: message.channelId,
      keyword: config.keyword,
      estimatedCost: config.estimatedCost,
      count: mentions.length,
      totalSpend: mentions.length * config.estimatedCost,
    };
  }

  return null;
}
