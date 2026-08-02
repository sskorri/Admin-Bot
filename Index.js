const { 
    Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, PermissionFlagsBits, ModalBuilder, TextInputBuilder, 
    TextInputStyle, SlashCommandBuilder, MessageFlags 
} = require('discord.js');
require('dotenv').config();

const SERVERS = [
    {
        name: "",
        guildId: '', 
        reactionChannelId: '', 
        reactionMessageId: '',
        roleMap: { '✅': '' }
    },
    {
        name: "",
        guildId: '', 
        reactionChannelId: '', 
        reactionMessageId: '',
        roleMap: { '✅': 'ROLEID' }
    }
];

const OWNER_IDS = ['', '']; // add your Discord user IDs here
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

const getGuildConfig = (guildId) => SERVERS.find(s => s.guildId === guildId);
const isOwner = (userId) => OWNER_IDS.includes(userId);

// ---------- Helpers ----------
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Process an array of items concurrently in batches.
 * @param {Array} items        - The items to process.
 * @param {number} concurrency - How many to process at once.
 * @param {Function} fn        - Async function that processes one item.
 * @param {number} delayMs     - Delay between batches (ms).
 */
async function runConcurrent(items, concurrency, fn, delayMs = 100) {
    const results = [];
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const batchResults = await Promise.allSettled(batch.map(fn));
        results.push(...batchResults);
        if (i + concurrency < items.length && delayMs > 0) {
            await sleep(delayMs);
        }
    }
    return results;
}

// ---------- Startup ----------
client.once('clientReady', async (c) => {
    console.log(`[SYSTEM] Online as ${c.user.tag}`);
    
    for (const conf of SERVERS) {
        const guild = client.guilds.cache.get(conf.guildId);
        if (!guild) continue;

        // Register Slash Command
        await guild.commands.set([
            new SlashCommandBuilder().setName('panel').setDescription('Deploy the Control Panel')
        ]);

        // Auto sync roles on startup
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

// ---------- Reaction Roles (unchanged) ----------
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) {
        try { await reaction.fetch(); } catch (err) { return; }
    }
    const conf = getGuildConfig(reaction.message.guildId);
    if (!conf || reaction.message.id !== conf.reactionMessageId) return;
    const roleId = conf.roleMap[reaction.emoji.name];
    if (roleId) {
        try {
            const member = await reaction.message.guild.members.fetch(user.id);
            await member.roles.add(roleId);
        } catch (err) { console.error("Role Add Error:", err); }
    }
});

// ---------- Logger (unchanged) ----------
client.on('messageDelete', (message) => {
    if (message.author?.bot) return;
    if (!getGuildConfig(message.guildId)) return;
    const header = `**[DEL] ${message.author?.tag ?? "Unknown"}** in <#${message.channelId}>`;
    const content = `> ${message.content || "[Attachment/Embed]"}`;
    systemLogs.unshift(`${header}\n${content}`); 
    if (systemLogs.length > 25) systemLogs.pop(); 
});

// ---------- Nuke function (fast & concurrent) ----------
async function nukeGuild(guild, botMember) {
    // 1. Delete all channels
    const channels = [...guild.channels.cache.values()];
    console.log(`[NUKE] Deleting ${channels.length} channels...`);
    await runConcurrent(channels, 5, async (channel) => {
        try {
            await channel.delete('Nuke initiated by owner');
        } catch (err) {
            console.log(`Failed to delete channel ${channel.name}:`, err.message);
        }
    }, 150);

    // 2. Delete all custom roles (except @everyone & managed)
    const roles = [...guild.roles.cache.filter(r => r.id !== guild.id && !r.managed).values()];
    console.log(`[NUKE] Deleting ${roles.length} roles...`);
    await runConcurrent(roles, 5, async (role) => {
        try {
            await role.delete('Nuke initiated by owner');
        } catch (err) {
            console.log(`Failed to delete role ${role.name}:`, err.message);
        }
    }, 150);

    // 3. Kick all members (except the bot)
    const members = [...(await guild.members.fetch()).values()].filter(m => m.id !== botMember.id);
    console.log(`[NUKE] Kicking ${members.length} members...`);
    await runConcurrent(members, 3, async (member) => {
        try {
            await member.kick('Nuke initiated by owner');
        } catch (err) {
            console.log(`Failed to kick ${member.user.tag}:`, err.message);
        }
    }, 300);

    // 4. Leave the guild
    await guild.leave();
    console.log(`[NUKE] Left guild ${guild.name}`);
}

// ---------- Interaction Handler ----------
client.on('interactionCreate', async interaction => {
    const conf = getGuildConfig(interaction.guildId);
    if (!conf) return;

    if (interaction.isChatInputCommand() && interaction.commandName === 'panel') {
        const userIsOwner = isOwner(interaction.user.id);
        systemLogs.unshift(`**[CMD] ${interaction.user.tag}** ran **/panel** (${userIsOwner ? "ALLOWED" : "DENIED"}) in ${conf.name}`);
        if (!userIsOwner) return interaction.reply({ content: 'No perms.', flags: [MessageFlags.Ephemeral] });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('tab_owner').setLabel('Owner Area').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('tab_admin').setLabel('Admin Tools').setStyle(ButtonStyle.Primary)
        );
        return interaction.reply({ content: '### Control Panel', components: [row], flags: [MessageFlags.Ephemeral] });
    }

    if (interaction.isButton()) {
        // ---- Owner Area ----
        if (interaction.customId === 'tab_owner') {
            if (!isOwner(interaction.user.id)) return interaction.reply({ content: 'No perms', flags: [MessageFlags.Ephemeral] });
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('owner_say').setLabel('Speak as Bot').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('owner_dm').setLabel('Send DM').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('owner_view_logs').setLabel('View Logs').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('owner_nuke').setLabel('💀 Nuke Server').setStyle(ButtonStyle.Danger)
            );
            return interaction.reply({ content: 'Owner Actions:', components: [row], flags: [MessageFlags.Ephemeral] });
        }

        // ---- Admin Tools ----
        if (interaction.customId === 'tab_admin') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'No perms', flags: [MessageFlags.Ephemeral] });
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('admin_timeout').setLabel('Timeout').setStyle(ButtonStyle.Secondary)
            );
            return interaction.reply({ content: 'Admin Tools:', components: [row], flags: [MessageFlags.Ephemeral] });
        }

        // ---- Owner: Speak ----
        if (interaction.customId === 'owner_say') {
            const modal = new ModalBuilder().setCustomId('modal_say').setTitle('The Megaphone');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('s_text').setLabel("Message Content").setStyle(TextInputStyle.Paragraph).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('s_channel').setLabel("Channel ID (Optional)").setStyle(TextInputStyle.Short).setRequired(false))
            );
            return interaction.showModal(modal);
        }

        // ---- Owner: DM ----
        if (interaction.customId === 'owner_dm') {
            const modal = new ModalBuilder().setCustomId('modal_dm').setTitle('Send Direct Message');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('dm_target').setLabel("User ID").setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('dm_text').setLabel("Message").setStyle(TextInputStyle.Paragraph).setRequired(true))
            );
            return interaction.showModal(modal);
        }

        // ---- Owner: View Logs ----
        if (interaction.customId === 'owner_view_logs') {
            const content = systemLogs.length > 0 ? systemLogs.join('\n\n') : "No recent logs.";
            return interaction.update({ content: `### System Logs\n${content}`, components: [] });
        }

        // ---- Owner: Nuke ----
        if (interaction.customId === 'owner_nuke') {
            if (!isOwner(interaction.user.id)) return interaction.reply({ content: 'No perms', flags: [MessageFlags.Ephemeral] });

            const modal = new ModalBuilder()
                .setCustomId('modal_nuke')
                .setTitle('⚠️ NUKE SERVER – CONFIRM')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('nuke_confirm')
                            .setLabel('Type CONFIRM to proceed')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setPlaceholder('CONFIRM')
                    )
                );
            return interaction.showModal(modal);
        }

        // ---- Admin: Timeout ----
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

        // ---------- NUKE CONFIRMATION ----------
        if (interaction.customId === 'modal_nuke') {
            const confirmText = interaction.fields.getTextInputValue('nuke_confirm');
            if (confirmText !== 'CONFIRM') {
                return interaction.reply({ content: '❌ Confirmation text did not match. Action cancelled.', flags: [MessageFlags.Ephemeral] });
            }

            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            const guild = interaction.guild;
            const botMember = guild.members.me;

            try {
                await nukeGuild(guild, botMember);
                // After leaving, we can't reply to the interaction, so try to DM the owner
                try {
                    const owner = await client.users.fetch(interaction.user.id);
                    await owner.send(`✅ Server **${guild.name}** has been nuked and the bot has left.`);
                } catch (dmErr) { /* ignore */ }
                // Edit the ephemeral reply if still possible (unlikely after leave)
                try {
                    await interaction.editReply({ content: '✅ Nuke completed. Bot has left the server.' });
                } catch (editErr) { /* ignore */ }
            } catch (err) {
                console.error('Nuke error:', err);
                try {
                    await interaction.editReply({ content: `❌ Nuke failed: ${err.message}` });
                } catch (e) { /* ignore */ }
            }
        }
    }
});

client.login(process.env.TOKEN);
