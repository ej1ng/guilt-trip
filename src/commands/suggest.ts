import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";

import { generateSuggestion } from "../lib/generate-suggestion.js";
import { GeminiQuotaError } from "../lib/parse-trips.js";
import { getSuggestionPipelineResult } from "../lib/trip-pipeline.js";
import type { PricedTrip, SuggestionResult } from "../lib/types.js";

function buildNoTripsReply() {
  return "Suggestion file is empty: I could not find any trip leads with bookable Stay22 prices yet.";
}

function buildSuggestionEmbed(suggestion: SuggestionResult, pricedTrips: PricedTrip[]) {
  const recommendedTrip = pricedTrips.find(
    (trip) => trip.destination === suggestion.recommendedDestination,
  );

  const embed = new EmbedBuilder()
    .setTitle(`Best trip to actually do: ${suggestion.recommendedDestination}`)
    .setDescription(suggestion.rationale)
    .setColor(0x8a5a00)
    .setFooter({ text: "Guilt Trip feasibility report" });

  suggestion.rankedTrips.forEach((trip, index) => {
    const pricedTrip = pricedTrips.find((candidate) => candidate.destination === trip.destination);
    const priceLine = pricedTrip
      ? `${pricedTrip.hotelName} · ~$${pricedTrip.totalCostPerPerson}/person · [Book](${pricedTrip.bookingUrl})`
      : "No current hotel price found.";

    embed.addFields({
      name: `${index + 1}. ${trip.destination} (${trip.feasibilityScore}/10)`,
      value: `${trip.reason}\nNext step: ${trip.nextStep}\n${priceLine}`,
    });
  });

  if (recommendedTrip) {
    embed.addFields({
      name: "Why this is the move",
      value: `${recommendedTrip.destination} has ${recommendedTrip.mentionCount} mention${
        recommendedTrip.mentionCount === 1 ? "" : "s"
      }, ${recommendedTrip.participants.length || 2} likely traveler${
        (recommendedTrip.participants.length || 2) === 1 ? "" : "s"
      }, and a real booking option under the group chat microscope.`,
    });
  }

  return embed;
}

function buildBookingButton(suggestion: SuggestionResult, pricedTrips: PricedTrip[]) {
  const recommendedTrip =
    pricedTrips.find((trip) => trip.destination === suggestion.recommendedDestination) ??
    pricedTrips[0];

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel(`Book ${recommendedTrip.destination}`)
      .setStyle(ButtonStyle.Link)
      .setURL(recommendedTrip.bookingUrl),
  );
}

export const suggestCommand = {
  data: new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Suggest the most feasible trip based on chat history and prices."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    let pipelineResult;

    try {
      pipelineResult = await getSuggestionPipelineResult(interaction);
    } catch (error) {
      if (error instanceof GeminiQuotaError) {
        await interaction.editReply(
          "Suggestion paused: Gemini rejected the request because the current API key has no available quota.",
        );
        return;
      }

      throw error;
    }

    if (!pipelineResult.transcript) {
      await interaction.editReply(
        "Suggestion file is empty: I could not find enough non-bot message history to investigate.",
      );
      return;
    }

    if (pipelineResult.pricedTrips.length === 0) {
      await interaction.editReply(buildNoTripsReply());
      return;
    }

    const suggestion = await generateSuggestion(
      pipelineResult.pricedTrips,
      pipelineResult.sentiments,
    );

    await interaction.editReply({
      embeds: [buildSuggestionEmbed(suggestion, pipelineResult.pricedTrips)],
      components: [buildBookingButton(suggestion, pipelineResult.pricedTrips)],
    });
  },
};
