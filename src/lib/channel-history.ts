import type { ChatInputCommandInteraction, Collection, Message } from "discord.js";

const TARGET_MESSAGE_COUNT = 200;
const PAGE_SIZE = 100;

interface CachedChannelMessage {
  id: string;
  channelId: string;
  username: string;
  content: string;
  createdTimestamp: number;
}

const channelMessageCache = new Map<string, CachedChannelMessage[]>();

function toCachedMessage(message: Message): CachedChannelMessage | null {
  const content = message.content.trim();

  if (message.author.bot || content.length === 0) {
    return null;
  }

  return {
    id: message.id,
    channelId: message.channelId,
    username: message.author.username,
    content,
    createdTimestamp: message.createdTimestamp,
  };
}

function writeMessagesToCache(channelId: string, messages: CachedChannelMessage[]) {
  const existingMessages = channelMessageCache.get(channelId) ?? [];
  const messagesById = new Map<string, CachedChannelMessage>();

  [...existingMessages, ...messages].forEach((message) => {
    messagesById.set(message.id, message);
  });

  const nextMessages = [...messagesById.values()]
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .slice(-TARGET_MESSAGE_COUNT);

  channelMessageCache.set(channelId, nextMessages);
}

async function fetchRecentMessages(interaction: ChatInputCommandInteraction) {
  const channel = interaction.channel;

  if (!channel || !("messages" in channel)) {
    throw new Error("This command must be run in a channel with readable message history.");
  }

  const messages: Message[] = [];
  let before: string | undefined;

  while (messages.length < TARGET_MESSAGE_COUNT) {
    const remaining = TARGET_MESSAGE_COUNT - messages.length;
    const limit = Math.min(PAGE_SIZE, remaining);

    try {
      const fetched: Collection<string, Message> = await channel.messages.fetch({
        limit,
        before,
      });

      if (fetched.size === 0) {
        break;
      }

      messages.push(...fetched.values());
      before = fetched.last()?.id;

      if (fetched.size < limit) {
        break;
      }
    } catch (error) {
      if (messages.length > 0) {
        console.warn("Stopped fetching message history early:", error);
        break;
      }

      throw error;
    }
  }

  const cachedMessages = messages
    .map(toCachedMessage)
    .filter((message): message is CachedChannelMessage => message !== null);

  writeMessagesToCache(channel.id, cachedMessages);

  return cachedMessages;
}

function formatTranscript(messages: CachedChannelMessage[]) {
  return messages
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((message) => `${message.username}: ${message.content}`)
    .join("\n");
}

export function recordChannelMessage(message: Message) {
  const cachedMessage = toCachedMessage(message);

  if (!cachedMessage) {
    return;
  }

  writeMessagesToCache(message.channelId, [cachedMessage]);
}

export async function getChannelTranscript(interaction: ChatInputCommandInteraction) {
  const channelId = interaction.channelId;
  const cachedMessages = channelMessageCache.get(channelId);

  if (cachedMessages && cachedMessages.length > 0) {
    return formatTranscript(cachedMessages);
  }

  const messages = await fetchRecentMessages(interaction);

  return formatTranscript(messages);
}
