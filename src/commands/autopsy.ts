import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";

import { generateRoast } from "../lib/generate-roast.js";
import { GeminiQuotaError } from "../lib/parse-trips.js";
import { getTripPipelineResult } from "../lib/trip-pipeline.js";
import type { PricedTrip, RoastResult } from "../lib/types.js";

function buildSummary(
  pendingDestinations: string[],
  pricedTrips: PricedTrip[],
) {
  if (pendingDestinations.length === 0) {
    return "Autopsy complete: found 0 pending trip leads. Suspiciously decisive channel.";
  }

  const sections = [
    `Autopsy complete: found ${pendingDestinations.length} pending trip${
      pendingDestinations.length === 1 ? "" : "s"
    }.`,
  ];

  if (pendingDestinations.length > 0) {
    sections.push(pendingDestinations.map((destination) => `- ${destination}`).join("\n"));
  }

  if (pendingDestinations.length > 0 && pricedTrips.length === 0) {
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

  return sections.join("\n");
}

function buildRoastEmbed(roast: RoastResult) {
  const embed = new EmbedBuilder()
    .setTitle(`${roast.trips.length} Pending trip${roast.trips.length === 1 ? "" : "s"}`)
    .setDescription(`${roast.headline}\n\n${roast.closingLine}`)
    .setColor(0x8a5a00)
    .setFooter({ text: "Guilt Trip todo list" });

  roast.trips.forEach((trip, index) => {
    const roastLine =
      roast.roastLines[index] ??
      `${trip.destination}: about $${trip.totalCostPerPerson}/person to make the group chat stop lying.`;

    embed.addFields({
      name: `[ ] ${trip.destination}`,
      value: `${roastLine}\nTodo: pick dates, confirm the group, and book ${trip.hotelName} (~$${trip.totalCostPerPerson}/person).\n[Booking link](${trip.bookingUrl})`,
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
    .setDescription("Autopsy the channel's pending trip plans."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    let pipelineResult;

    try {
      pipelineResult = await getTripPipelineResult(interaction);
    } catch (error) {
      if (error instanceof GeminiQuotaError) {
        await interaction.editReply(
          "Autopsy paused: Gemini rejected the request because the current API key has no available quota for `gemini-2.0-flash`. Check the Google AI Studio quota/billing settings, then try again.",
        );
        return;
      }

      throw error;
    }

    if (pipelineResult.pendingTrips.length === 0) {
      if (pipelineResult.trips.length > 0) {
        const destinations = pipelineResult.trips
          .map((trip) => trip.destination)
          .join(", ");

        await interaction.editReply(
          `I found trip chatter in the database (${destinations}), but none of it looks like a pending plan yet. Try a messier channel.`,
        );
        return;
      }

      await interaction.editReply(
        "This server is suspiciously decisive. Try a messier channel.",
      );
      return;
    }

    if (pipelineResult.pricedTrips.length === 0) {
      await interaction.editReply(
        buildSummary(
          pipelineResult.pendingTrips.map((trip) => trip.destination),
          pipelineResult.pricedTrips,
        ),
      );
      return;
    }

    const roast = await generateRoast(pipelineResult.pricedTrips);
    const topTrip = [...roast.trips].sort((a, b) => b.mentionCount - a.mentionCount)[0];

    await interaction.editReply(
      {
        embeds: [buildRoastEmbed(roast)],
        components: [buildBookingButton(topTrip)],
      },
    );
  },
};
