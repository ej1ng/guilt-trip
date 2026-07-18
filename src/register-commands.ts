import "dotenv/config";
import { REST, Routes } from "discord.js";

import { commands } from "./commands/index.js";

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export async function registerGuildCommands() {
  const token = requireEnv("DISCORD_TOKEN");
  const clientId = requireEnv("DISCORD_CLIENT_ID");
  const guildId = requireEnv("DISCORD_GUILD_ID");

  const rest = new REST({ version: "10" }).setToken(token);
  const commandPayload = commands.map((command) => command.data.toJSON());

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commandPayload,
  });

  console.log(`Registered ${commandPayload.length} guild command(s).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  registerGuildCommands().catch((error) => {
    console.error("Failed to register guild commands:", error);
    process.exit(1);
  });
}
