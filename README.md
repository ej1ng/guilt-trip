# Guilt Trip

Guilt Tripper is a Discord bot that guilt-trips plans out of the group chat.

It watches trip chatter, spending keywords, and group-chat indecision, then turns that into structured trip data, real hotel prices, and funny booking nudges. The main flow finds pending trip ideas, prices them with Stay22, and posts a roast-style todo list with booking links.

## Current Features

- `/guilttrip` finds pending or unresolved trip ideas in the current channel, prices them, and posts a todo-style Discord embed.
- `/suggest` recommends which pending trip the group should actually take based on pricing, sentiment, constraints, and preferences.
- `/debugdb` shows a private debug snapshot of stored trip mentions, sentiments, and prices for the current channel.
- Passive keyword callouts track spending keywords like `brunch`, `shopping`, `retail therapy`, `dinner`, `drink`, `uber`, and `doordash`.
- Plan-confirmation callouts trigger when a spending idea starts making it out of the chat, e.g. `let's get dinner` followed by `I'm down`.
- SQLite stores structured trip, sentiment, and price data without storing every raw Discord message.

## Prerequisites

- Node.js 20+
- A Discord server where you can install a test bot
- Discord Developer Portal access
- A Google Gemini API key
- A Stay22 API key

## Discord Setup

1. Create a Discord application at the [Discord Developer Portal](https://discord.com/developers/applications).
2. Open the application, go to **Bot**, and create a bot.
3. In **Bot > Privileged Gateway Intents**, enable **Message Content Intent**. This is required for message history parsing, async sentiment scanning, and passive keyword callouts.
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

Do not commit `.env`. The local SQLite database is written under `data/` and is ignored by git.

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
2. Check the console for `Registered 3 guild command(s).` and `Logged in as ...`.
3. In the test server, type `/guilttrip`.
4. If there are stored or detected pending trips, the bot should return a todo-style embed with hotel pricing and a booking button.
5. Try `/suggest` to get a recommendation for the most feasible trip.
6. Try `/debugdb` to inspect the current channel's stored structured data.

For passive callouts, send a tracked keyword three times, such as `brunch`, or try a plan-confirmation sequence:

```text
let's get dinner
i'm down
```

The bot should send a spending-to-trip callout once the threshold or confirmation pattern is hit.

## How The Pipeline Works

### Message Listener

On every non-bot message, the bot:

1. Adds the message to a small in-memory channel cache for recent transcript context.
2. Checks passive spending keywords and plan-confirmation phrases.
3. Uses Gemini on likely trip-related messages to extract structured sentiment.
4. Stores only structured summaries in SQLite, such as destination, sentiment, preferences, constraints, confidence, and privacy-safe evidence summaries.

### `/guilttrip`

1. Loads stored trip mentions for the current channel first.
2. If needed, parses recent channel history with Gemini to find pending trip ideas.
3. Normalizes destinations so variants like `bahamas`, `Bahamas`, and `the Bahamas` merge.
4. Prices pending trips through Stay22, refreshing stale prices after 24 hours.
5. Generates roast copy with Gemini.
6. Responds with a Discord embed and booking button.

### `/suggest`

`/suggest` uses the same stored trip and pricing data, plus sentiment rows, to rank which trip is most feasible for the group.

### Passive Keyword Callouts

Tracked keywords live in `src/lib/keyword-tracker.ts`. When a keyword threshold is hit, or a plan-confirmation sequence is detected, `src/lib/keyword-callout.ts` sends a roast that converts the spending into nights toward a trip.

The callout checks the current channel's stored trips first. If a priced trip exists, it uses that destination. If only an unpriced trip exists, it prices it with Stay22 and saves the result. If no stored trips exist, it falls back to a random default destination, with Montreal as the final fallback.

## Data Storage

SQLite tables are managed in `src/lib/db.ts`:

- `trip_mentions` stores normalized trip leads and mention counts.
- `trip_sentiments` stores privacy-safe sentiment summaries per user and destination.
- `trip_prices` stores Stay22 hotel pricing and booking links.

The bot does not store every raw chat message in SQLite.

## Scripts

- `npm run dev` starts the bot with `tsx`.
- `npm run register` registers guild-scoped slash commands.
- `npm run build` type-checks the project with TypeScript.
- `npm start` starts the bot with `tsx`.