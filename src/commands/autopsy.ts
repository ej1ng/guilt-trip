import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Collection,
  EmbedBuilder,
  Message,
  SlashCommandBuilder,
} from "discord.js";

import { generateRoast } from "../lib/generate-roast.js";
import { GeminiQuotaError, parseTrips } from "../lib/parse-trips.js";
import { priceTrips } from "../lib/price-trips.js";
import type { PricedTrip, RoastResult } from "../lib/types.js";

const TARGET_MESSAGE_COUNT = 200;
const PAGE_SIZE = 100;

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

  return messages;
}

function formatTranscript(messages: Message[]) {
  return messages
    .filter((message) => !message.author.bot && message.content.trim().length > 0)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((message) => `${message.author.username}: ${message.content.trim()}`)
    .join("\n");
}

function buildSummary(
  deadDestinations: string[],
  unclearDestinations: string[],
  pricedTrips: PricedTrip[],
) {
  if (deadDestinations.length === 0 && unclearDestinations.length === 0) {
    return "Autopsy complete: found 0 trip leads. Suspiciously innocent channel.";
  }

  const sections = [
    `Autopsy complete: found ${deadDestinations.length} dead trip${
      deadDestinations.length === 1 ? "" : "s"
    }.`,
  ];

  if (deadDestinations.length > 0) {
    sections.push(deadDestinations.map((destination) => `- ${destination}`).join("\n"));
  }

  if (deadDestinations.length > 0 && pricedTrips.length === 0) {
    sections.push("Stay22 pricing found 0 bookable hotel results for those trips.");
  }

  if (pricedTrips.length > 0) {
    sections.push(
      [
        `Priced ${pricedTrips.length} trip${pricedTrips.length === 1 ? "" : "s"}:`,
        ...pricedTrips.map(
          (trip) =>
            `- ${trip.destination}: ~$${trip.totalCostPerPerson}/person for ${trip.suggestedNights} nights at ${trip.hotelName}`,
        ),
      ].join("\n"),
    );
  }

  if (unclearDestinations.length > 0) {
    sections.push(
      `Also found ${unclearDestinations.length} unclear trip lead${
        unclearDestinations.length === 1 ? "" : "s"
      }: ${unclearDestinations.join(", ")}`,
    );
  }

  return sections.join("\n");
}

function buildRoastEmbed(roast: RoastResult) {
  const embed = new EmbedBuilder()
    .setTitle(roast.headline)
    .setDescription(roast.closingLine)
    .setColor(0x8a5a00)
    .setFooter({ text: "Guilt Trip case file" });

  roast.trips.forEach((trip, index) => {
    const roastLine =
      roast.roastLines[index] ??
      `${trip.destination}: about $${trip.totalCostPerPerson}/person to make the group chat stop lying.`;

    embed.addFields({
      name: trip.destination,
      value: `${roastLine}\n${trip.hotelName} · ~$${trip.totalCostPerPerson}/person\n[Book the evidence](${trip.bookingUrl})`,
    });
  });

  return embed;
}

function buildBookingButton(topTrip: PricedTrip) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel(`Book ${topTrip.destination}`)
      .setStyle(ButtonStyle.Link)
      .setURL(topTrip.bookingUrl),
  );
}

export const autopsyCommand = {
  data: new SlashCommandBuilder()
    .setName("guilttrip")
    .setDescription("Autopsy the channel's abandoned trip plans."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const messages = await fetchRecentMessages(interaction);
    const transcript = formatTranscript(messages);

    if (!transcript) {
      await interaction.editReply(
        "Autopsy complete: I could not find enough non-bot message history to investigate.",
      );
      return;
    }

    let trips;

    try {
      trips = await parseTrips(transcript);
    } catch (error) {
      if (error instanceof GeminiQuotaError) {
        await interaction.editReply(
          "Autopsy paused: Gemini rejected the request because the current API key has no available quota for `gemini-2.0-flash`. Check the Google AI Studio quota/billing settings, then try again.",
        );
        return;
      }

      throw error;
    }

    const deadTrips = trips.filter((trip) => trip.status === "dead");
    const unclearTrips = trips.filter((trip) => trip.status === "unclear");
    const pricedTrips = await priceTrips(deadTrips);

    if (pricedTrips.length === 0) {
      await interaction.editReply(
        buildSummary(
          deadTrips.map((trip) => trip.destination),
          unclearTrips.map((trip) => trip.destination),
          pricedTrips,
        ),
      );
      return;
    }

    const roast = await generateRoast(pricedTrips);
    const topTrip = [...roast.trips].sort((a, b) => b.mentionCount - a.mentionCount)[0];

    await interaction.editReply(
      {
        embeds: [buildRoastEmbed(roast)],
        components: [buildBookingButton(topTrip)],
      },
    );
  },
};
