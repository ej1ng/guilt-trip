import type { Message } from "discord.js";

const ROLLING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CHANNEL_COOLDOWN_MS = 10 * 1000;
const PLAN_CONFIRMATION_WINDOW_MS = 10 * 60 * 1000;

export interface KeywordTrigger {
  channelId: string;
  keyword: string;
  estimatedCost: number;
  count: number;
  totalSpend: number;
  kind: "threshold" | "plan-confirmed";
}

interface KeywordConfig {
  keyword: string;
  estimatedCost: number;
  threshold: number;
}

interface KeywordTally {
  mentions: number[];
}

interface PendingKeywordPlan {
  keyword: string;
  estimatedCost: number;
  startedAt: number;
  count: number;
}

export const TRACKED_KEYWORDS: KeywordConfig[] = [
  { keyword: "brunch", estimatedCost: 25, threshold: 3 },
  { keyword: "shopping", estimatedCost: 60, threshold: 3 },
  { keyword: "uber", estimatedCost: 15, threshold: 3 },
  { keyword: "doordash", estimatedCost: 20, threshold: 3 },
  { keyword: "coffee", estimatedCost: 7, threshold: 3 },
  { keyword: "concert", estimatedCost: 80, threshold: 3 },
  { keyword: "go out for dinner", estimatedCost: 45, threshold: 3 },
  { keyword: "dinner", estimatedCost: 45, threshold: 3 },
  { keyword: "retail therapy", estimatedCost: 75, threshold: 3 },
  { keyword: "drink", estimatedCost: 35, threshold: 3 },
  { keyword: "drinks", estimatedCost: 35, threshold: 3 },
  { keyword: "takeout", estimatedCost: 25, threshold: 3 },
  { keyword: "happy hour", estimatedCost: 30, threshold: 3 },
  { keyword: "boba", estimatedCost: 8, threshold: 3 },
  { keyword: "movie", estimatedCost: 20, threshold: 3 },
];

const tallies = new Map<string, KeywordTally>();
const channelCooldowns = new Map<string, number>();
const pendingKeywordPlans = new Map<string, PendingKeywordPlan>();

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

function looksLikePlanConfirmation(content: string) {
  return [
    /\b(yes|yeah|yup|ok|okay)\s+(lets|let['’]?s)\s+go\b/i,
    /\b(lets|let['’]?s)\s+go\b/i,
    /\bi['’]?m down\b/i,
    /\bwhat time\b/i,
    /\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b/i,
    /\bsee you\b/i,
    /\bwe going\b/i,
    /\bbook(ed|ing)?\b/i,
  ].some((pattern) => pattern.test(content));
}

function getActivePendingPlan(channelId: string, now: number) {
  const pendingPlan = pendingKeywordPlans.get(channelId);

  if (!pendingPlan) {
    return null;
  }

  if (now - pendingPlan.startedAt > PLAN_CONFIRMATION_WINDOW_MS) {
    pendingKeywordPlans.delete(channelId);
    return null;
  }

  return pendingPlan;
}

export function trackKeywordMessage(message: Message): KeywordTrigger | null {
  const content = message.content.toLowerCase();
  const now = Date.now();

  if (message.author.bot || content.trim().length === 0) {
    return null;
  }

  const pendingPlan = getActivePendingPlan(message.channelId, now);

  if (
    pendingPlan &&
    looksLikePlanConfirmation(content) &&
    !isChannelCoolingDown(message.channelId, now)
  ) {
    pendingKeywordPlans.delete(message.channelId);
    channelCooldowns.set(message.channelId, now);

    return {
      channelId: message.channelId,
      keyword: pendingPlan.keyword,
      estimatedCost: pendingPlan.estimatedCost,
      count: pendingPlan.count,
      totalSpend: pendingPlan.count * pendingPlan.estimatedCost,
      kind: "plan-confirmed",
    };
  }

  for (const config of TRACKED_KEYWORDS) {
    if (!matchesKeyword(content, config.keyword)) {
      continue;
    }

    const tallyKey = getTallyKey(message.channelId, config.keyword);
    const tally = tallies.get(tallyKey) ?? { mentions: [] };
    const mentions = [...pruneOldMentions(tally.mentions, now), now];

    tallies.set(tallyKey, { mentions });
    pendingKeywordPlans.set(message.channelId, {
      keyword: config.keyword,
      estimatedCost: config.estimatedCost,
      startedAt: now,
      count: mentions.length,
    });

    if (mentions.length < config.threshold || isChannelCoolingDown(message.channelId, now)) {
      continue;
    }

    tallies.set(tallyKey, { mentions: [] });
    pendingKeywordPlans.delete(message.channelId);
    channelCooldowns.set(message.channelId, now);

    return {
      channelId: message.channelId,
      keyword: config.keyword,
      estimatedCost: config.estimatedCost,
      count: mentions.length,
      totalSpend: mentions.length * config.estimatedCost,
      kind: "threshold",
    };
  }

  return null;
}
