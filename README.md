# Guilt Trip

Guilt Trip is a Discord bot for a hackathon demo. The main `/guilttrip` command will eventually read a channel's trip-planning history, find abandoned trip ideas, price them with Stay22 hotel data, and post a friendly roast with a booking link.

This scaffold registers the `/guilttrip` slash command in a single development guild and replies with `Autopsy triggered`.

## Prerequisites

- Node.js 20+
- A Discord server where you can install a test bot
- Discord Developer Portal access

## Discord Setup

1. Create a Discord application at the [Discord Developer Portal](https://discord.com/developers/applications).
2. Open the application, go to **Bot**, and create a bot.
3. In **Bot > Privileged Gateway Intents**, enable **Message Content Intent**. This is required for message history parsing and the future passive keyword listener.
4. Copy the bot token for `DISCORD_TOKEN`.
5. Go to **OAuth2 > General** and copy the application ID for `DISCORD_CLIENT_ID`.
6. In Discord, enable Developer Mode, right-click your test server, and copy the server ID for `DISCORD_GUILD_ID`.
7. In **OAuth2 > URL Generator**, select these scopes:
   - `bot`
   - `applications.commands`
8. Select these bot permissions:
   - View Channels
   - Send Messages
   - Read Message History
   - Embed Links
   - Use Slash Commands
9. Open the generated URL and invite the bot to your test server.

## Environment

Copy the example file and fill in real values:

```sh
cp .env.example .env
```

Required variables:

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
GEMINI_API_KEY=
STAY22_API_KEY=
```

## Install

```sh
npm install
```

## Register Slash Commands

Register commands to the test guild during development:

```sh
npm run register
```

Guild-scoped commands update almost instantly, which is better for live demo iteration. Global commands can take up to an hour to propagate.

## Run The Bot

```sh
npm run dev
```

Startup also registers guild-scoped commands before the bot logs in.

## Confirm It Works

1. Start the bot with `npm run dev`.
2. Check the console for `Registered 1 guild command(s).` and `Logged in as ...`.
3. In the test server, type `/guilttrip`.
4. The bot should reply: `Autopsy triggered`.

## Scripts

- `npm run dev` starts the bot with `tsx`.
- `npm run register` registers guild-scoped slash commands.
- `npm run build` type-checks the project with TypeScript.
- `npm start` starts the bot with `tsx`.