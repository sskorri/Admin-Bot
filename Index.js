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

const OWNER_IDS = ['', '']; //remove or add owners here
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

// Startup and Command Sync
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

// Live Reaction Roles
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    // Handle partials (messages sent while bot was offline)
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

// Compact Logger
client.on('messageDelete', (message) => {
    if (message.author?.bot) return;
    if (!getGuildConfig(message.guildId)) return;
    const header = `**[DEL] ${message.author?.tag ?? "Unknown"}** in <#${message.channelId}>`;
    const content = `> ${message.content || "[Attachment/Embed]"}`;
    systemLogs.unshift(`${header}\n${content}`); 
    if (systemLogs.length > 25) systemLogs.pop(); 
});

// Interaction Handler
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
        if (interaction.customId === 'tab_owner') {
            if (!isOwner(interaction.user.id)) return interaction.reply({ content: 'No perms', flags: [MessageFlags.Ephemeral] });
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('owner_say').setLabel('Speak as Bot').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('owner_dm').setLabel('Send DM').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('owner_view_logs').setLabel('View Logs').setStyle(ButtonStyle.Secondary)
            );
            return interaction.reply({ content: 'Owner Actions:', components: [row], flags: [MessageFlags.Ephemeral] });
        }

        if (interaction.customId === 'tab_admin') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'No perms', flags: [MessageFlags.Ephemeral] });
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('admin_timeout').setLabel('Timeout').setStyle(ButtonStyle.Secondary)
            );
            return interaction.reply({ content: 'Admin Tools:', components: [row], flags: [MessageFlags.Ephemeral] });
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
            return interaction.update({ content: `### System Logs\n${content}`, components: [] });
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
    }
});

client.login(process.env.TOKEN);
