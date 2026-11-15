# Bot

A Discord bot built in Node.js (discord.js v14) with reaction roles, message logging, moderation tools, and a destructive "nuke" panel for server owners.

---

## Features

- Reaction roles, optional and per-server. Assign roles from emoji reactions, with automatic re-sync on startup (catches users who reacted while the bot was offline).
- Message logging: logs both new messages and deleted messages into an in-bot log view, across every server the bot is in.
- `/panel` control panel: a private, ephemeral panel with two areas:
  - Owner Area (whitelisted user IDs only)
  - Admin Tools (server administrators)
- Owner tools
  - Speak as the bot (in any channel by ID)
  - Send a DM to any user
  - View logs
  - Server status (members, boosts, channels, roles, emojis, stickers, creation date)
  - User info (tag, ID, nickname, join date, roles, avatar)
  - Nuke server
- Admin tools
  - Timeout a member (1-28 days)
- Nuke: wipes a server, spams channels, changes the name/icon, and leaves (see [Nuke details](#nuke-details)). Owner-only, executes instantly.

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or newer (discord.js v14 requires it)
- A Discord application + bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- The bot invited to your server(s) with the required permissions

---

## Setup

### 1. Install dependencies

```bash
npm install
```

This downloads `discord.js` and `dotenv` into `node_modules`. Run it once after cloning, and again whenever you change `package.json`.

### 2. Create a `.env` file

In the project root, create a file named `.env` and add your bot token:

```env
TOKEN=your_bot_token_here
```

Never commit `.env` to git or share your token. If it leaks, reset it in the Developer Portal immediately.

### 3. Create the `icons` folder

The nuke feature picks a random image to set as the server icon before leaving.

1. Create a folder named `icons` in the same directory as `Index.js`.
2. Place any `.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif` files inside it. The bot will randomly select one during the nuke.

### 4. Enable the required intents

In the [Discord Developer Portal](https://discord.com/developers/applications) -> your app -> Bot -> Privileged Gateway Intents, enable:

- Server Members Intent (for member fetch, bans, timeouts)
- Message Content Intent (for logging message content)

### 5. Configure the bot in `Index.js`

The bot works in **every server it is invited to**. There is no server whitelist. Just set your trusted user IDs in `OWNER_IDS`:

```js
const OWNER_IDS = ['123456789012345678']; // Discord user IDs allowed to use the Owner Area
```

Optionally, to enable reaction roles in a server, fill in an entry in `REACTION_CONFIG`:

```js
const REACTION_CONFIG = [
    {
        name: "My Server",
        guildId: '123456789012345678',           // Server (guild) ID
        reactionChannelId: '123456789012345678', // Channel with the reaction-role message
        reactionMessageId: '123456789012345678', // Message ID of the reaction-role message
        roleMap: { '✅': '123456789012345678' }  // emoji -> role ID
    }
];
```

Servers **not** listed in `REACTION_CONFIG` simply won't have reaction roles; every other feature still works.

Enable Developer Mode in Discord (User Settings -> Advanced) so you can right-click -> Copy ID on servers, channels, messages, roles, and users.

### 6. Bot permissions

When inviting the bot, grant at minimum:

- Manage Roles (reaction roles)
- Manage Channels, Manage Roles, Manage Emojis & Stickers, Ban Members, Manage Server (for the nuke)
- Moderate Members (timeouts)
- Read/Send Messages, Read Message History (logging, panel)

The simplest option is to give it Administrator, which is required for the nuke to fully work anyway.

### 7. Start the bot

```bash
node Index.js
```

You should see something like:

```
[SYSTEM] Online as YourBot#1234
[CMD] Cleared global commands to prevent conflicts.
[CMD] Registered /panel in My Server
[SYNC] Checking reactions for My Server...
```

On startup the bot registers the `/panel` slash command in **every server it's currently in**. It also clears global commands to prevent Discord client caching bugs. If you invite the bot to a new server later, it automatically registers `/panel` there instantly.

---

## Usage

### Opening the panel

In **any** server the bot is in, run:

```
/panel
```

Only users in `OWNER_IDS` can use it. You get an ephemeral (private) panel with two buttons:

| Button | Who can use it | What it does |
| :--- | :--- | :--- |
| Owner Area | `OWNER_IDS` | Opens owner-only actions |
| Admin Tools | Admins | Opens moderation actions |

### Owner Area

| Button | Description |
| :--- | :--- |
| Speak as Bot | Send a message as the bot to a channel (leave channel ID blank to use the current channel). |
| Send DM | DM a user by ID with a custom message. |
| View Logs | Show the last 50 logged entries (new messages + deleted messages + commands). |
| Server Status | Show member count, boosts, channel/role/emoji/sticker counts, owner, and creation date. |
| User Info | Look up a member by ID or mention (tag, nickname, join date, roles, avatar). |
| Nuke Server | Destroys the server (see below). No confirmation required. |

### Admin Tools

| Button | Description |
| :--- | :--- |
| Timeout | Timeout a member by ID for 1-28 days. |

### Reaction roles (optional)

Only servers listed in `REACTION_CONFIG` support reaction roles. For each entry:

1. Post a message in the configured `reactionChannelId`.
2. React to it with the emojis defined in `roleMap`.
3. Put the message ID in `reactionMessageId`.

Users who react get the matching role. On every bot restart, the bot re-scans the reactions and re-adds any missing roles.

---

## Nuke details

Owner-only. Irreversible. Clicking the button executes the nuke instantly.

When triggered, the bot runs these steps:

1. **Bans all members** (except the server owner, the bot, and the person who initiated the nuke). Deletes 7 days of their messages.
2. **Deletes all channels** (text, voice, categories, etc.)
3. **Deletes all custom roles** (except `@everyone` and bot-managed roles)
4. **Deletes all emojis**
5. **Deletes all stickers**
6. **Deletes all scheduled events**
7. **Spams new channels**: creates 50 text channels, 50 voice channels, and 10 forum channels.
8. **Removes the vanity URL** (if the server has one)
9. **Server update**: changes the server name once to `NUKED-xxxxxx` and applies a **random icon** from your `icons` folder.
10. **Leaves the server**

The server itself is not deleted; only the server owner can delete a server via Discord. After the nuke, the server is left destroyed and the bot has left.

The nuke is rate-limit tolerant: individual failures are ignored so the process always completes. On very large servers, some actions may be skipped due to Discord rate limits.

Do not run this on a server you don't own or don't want destroyed.

---

## Keeping the bot online

`node Index.js` stops when you close the terminal. For 24/7 hosting, use a process manager such as [PM2](https://pm2.keymetrics.io/):

```bash
npm install -g pm2
pm2 start Index.js --name discord-bot
pm2 save
pm2 startup   # follow the printed instructions
```

Useful PM2 commands:

```bash
pm2 logs discord-bot    # view live logs
pm2 restart discord-bot # restart after editing files
pm2 stop discord-bot    # stop the bot
pm2 status              # list running processes
```

You can also run the bot on a VPS, a Raspberry Pi, or a hosting service that supports Node.js.

---

## Troubleshooting

| Problem | Fix |
| :--- | :--- |
| `Used disallowed intents` | You need to enable **Server Members Intent** and **Message Content Intent** in the Discord Developer Portal under the Bot tab. |
| `Cannot find module 'discord.js'` | Dependencies not installed. Run `npm install` in the folder containing `package.json`. |
| `Error: An invalid token was provided` | Check `TOKEN` in `.env`, no quotes, no spaces. Reset the token if unsure. |
| Slash command `/panel` doesn't appear | The bot registers it per-guild on startup. If you just invited the bot to a new server, restart it. |
| "No perms" in Owner Area | Your user ID isn't in `OWNER_IDS`. |
| Reaction roles not applying | Verify `reactionMessageId`, `reactionChannelId`, emoji keys in `roleMap`, and that the bot's role is above the role it's assigning. Also confirm the server is listed in `REACTION_CONFIG`. |
| Nuke didn't change the icon | Make sure you have an `icons` folder in the same directory as `Index.js` with valid image files. Check the console for read errors. |
| Nuke stops early / skips things | Rate limits. The bot logs failures to console; most servers complete quickly. |

---

## Security notes

- Keep `.env` private. Never paste your token into chat, screenshots, or public repos.
- Only add trusted user IDs to `OWNER_IDS`; they can nuke any server the bot is in.
- The nuke is destructive by design. Test in a throwaway server first.

---

## License

Personal project, no license specified. Use at your own risk.
