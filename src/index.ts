import "dotenv/config";
import { Events } from "discord.js";

import { commands } from "./commands/index.js";
import { analyzeAndStoreMessageSentiment } from "./lib/analyze-message-sentiment.js";
import { recordChannelMessage } from "./lib/channel-history.js";
import { createDiscordClient } from "./lib/discord-client.js";
import { sendKeywordCallout } from "./lib/keyword-callout.js";
import { trackKeywordMessage } from "./lib/keyword-tracker.js";
import { registerGuildCommands } from "./register-commands.js";

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function main() {
  const token = requireEnv("DISCORD_TOKEN");
  const client = createDiscordClient();
  const commandMap = new Map(commands.map((command) => [command.data.name, command]));

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}.`);
  });

  client.on(Events.MessageCreate, (message) => {
    void Promise.resolve()
      .then(async () => {
        recordChannelMessage(message);

        const keywordTrigger = trackKeywordMessage(message);

        if (keywordTrigger) {
          await sendKeywordCallout(message, keywordTrigger);
        }

        await analyzeAndStoreMessageSentiment(message);
      })
      .catch((error) => {
        console.error("Failed to scan channel message:", error);
      });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    const command = commandMap.get(interaction.commandName);

    if (!command) {
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Failed to execute /${interaction.commandName}:`, error);

      const fallback = "The autopsy table jammed. Try again in a minute.";

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: fallback, ephemeral: true });
        } else {
          await interaction.reply({ content: fallback, ephemeral: true });
        }
      } catch (replyError) {
        console.error("Failed to send command error response:", replyError);
      }
    }
  });

  await registerGuildCommands();
  await client.login(token);
}

main().catch((error) => {
  console.error("Failed to start bot:", error);
  process.exit(1);
});
