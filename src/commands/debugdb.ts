import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { getDbDebugSnapshot } from "../lib/db.js";

function truncate(value: string, maxLength = 900) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function formatMentions(snapshot: ReturnType<typeof getDbDebugSnapshot>) {
  if (snapshot.tripMentions.length === 0) {
    return "No trip mentions stored for this channel.";
  }

  return snapshot.tripMentions
    .map(
      (trip) =>
        `- ${trip.destination}: ${trip.mentionCount} mention${
          trip.mentionCount === 1 ? "" : "s"
        }, ${trip.participants.join(", ") || "no participants"}, status ${trip.status}`,
    )
    .join("\n");
}

function formatSentiments(snapshot: ReturnType<typeof getDbDebugSnapshot>) {
  if (snapshot.tripSentiments.length === 0) {
    return "No sentiments stored for this channel.";
  }

  return snapshot.tripSentiments
    .map(
      (sentiment) =>
        `- ${sentiment.destination}/${sentiment.username}: ${sentiment.sentiment}, ${sentiment.attitude}; ${sentiment.evidenceSummary}`,
    )
    .join("\n");
}

function formatPrices(snapshot: ReturnType<typeof getDbDebugSnapshot>) {
  if (snapshot.tripPrices.length === 0) {
    return "No prices stored for this channel.";
  }

  return snapshot.tripPrices
    .map(
      (trip) =>
        `- ${trip.destination}: ~$${trip.totalCostPerPerson}/person at ${trip.hotelName}`,
    )
    .join("\n");
}

export const debugDbCommand = {
  data: new SlashCommandBuilder()
    .setName("debugdb")
    .setDescription("Show the structured trip data stored for this channel."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const snapshot = getDbDebugSnapshot(interaction.channelId);
    const embed = new EmbedBuilder()
      .setTitle("Guilt Trip DB Debug")
      .setColor(0x8a5a00)
      .setDescription(
        `channel_id: ${interaction.channelId}\ntrip_mentions: ${snapshot.counts.tripMentions}\ntrip_sentiments: ${snapshot.counts.tripSentiments}\ntrip_prices: ${snapshot.counts.tripPrices}`,
      )
      .addFields(
        {
          name: "Trip Mentions",
          value: truncate(formatMentions(snapshot)),
        },
        {
          name: "Trip Sentiments",
          value: truncate(formatSentiments(snapshot)),
        },
        {
          name: "Trip Prices",
          value: truncate(formatPrices(snapshot)),
        },
      );

    await interaction.editReply({ embeds: [embed] });
  },
};
