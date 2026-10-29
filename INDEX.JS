const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Bot is Online!'));
app.listen(process.env.PORT || 3000);


require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ApplicationIntegrationType,
  InteractionContextType,
} = require("discord.js");

const { DISCORD_TOKEN, CLIENT_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("❌ Missing DISCORD_TOKEN or CLIENT_ID in .env");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const COOLDOWN_MS = 2000;
const MESSAGE_DELAY_MS = 750;
const MAX_MESSAGES = 20;

const cooldowns = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName("spam")
    .setDescription("Send a limited number of messages")
    .addStringOption(option =>
      option
        .setName("text")
        .setDescription("Message to send")
        .setRequired(true)
        .setMaxLength(1800)
    )
    .addIntegerOption(option =>
      option
        .setName("limit")
        .setDescription("Number of messages (1–20)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(MAX_MESSAGES)
    )
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel
    )
    .toJSON(),
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: commands,
  });

  console.log("✅ /spam command registered");
}

client.once("clientReady", readyClient => {
  console.log(`🤖 Logged in as ${readyClient.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "spam") return;

  // Acknowledge immediately to avoid Discord's interaction timeout.
  try {
    await interaction.deferReply({
      ephemeral: true,
    });
  } catch (error) {
    console.error("❌ Interaction acknowledgement failed:", error);
    return;
  }

  try {
    const userId = interaction.user.id;

    // In servers, only the server owner can use /spam.
    if (interaction.inGuild()) {
      const guild = interaction.guild;

      // Updated null check for server information.
      if (!guild) {
        await interaction.editReply(
          "❌ This app cannot access server information. Install the bot in this server and try again."
        );
        return;
      }

      if (interaction.user.id !== guild.ownerId) {
        await interaction.editReply(
          "❌ Only the server owner can use this command."
        );
        return;
      }
    } else {
      // In DMs, allow the user who invoked the user-installed app.
      const owners = interaction.authorizingIntegrationOwners ?? {};

      const installerId =
        owners[String(ApplicationIntegrationType.UserInstall)] ??
        owners[ApplicationIntegrationType.UserInstall];

      if (!installerId || installerId !== userId) {
        await interaction.editReply(
          "❌ Install this app to your Discord account to use it in DMs."
        );
        return;
      }
    }

    const text = interaction.options.getString("text", true);
    const limit = interaction.options.getInteger("limit", true);

    const now = Date.now();
    const lastUsed = cooldowns.get(userId) ?? 0;
    const remaining = COOLDOWN_MS - (now - lastUsed);

    if (remaining > 0) {
      await interaction.editReply(
        `⏳ Wait ${(remaining / 1000).toFixed(1)} seconds before using /spam again.`
      );
      return;
    }

    cooldowns.set(userId, now);

    if (interaction.inGuild()) {
      // Send ordinary messages in the server channel.
      const channel = interaction.channel;

      if (
        !channel ||
        !channel.isTextBased() ||
        typeof channel.send !== "function"
      ) {
        await interaction.editReply(
          "❌ This channel does not support ordinary messages."
        );
        return;
      }

      await interaction.editReply(
        `📨 Sending ${limit} messages...`
      );

      let sent = 0;

      for (let i = 0; i < limit; i++) {
        await channel.send({
          content: text,
          allowedMentions: { parse: [] },
        });

        sent++;

        if (i < limit - 1) {
          await new Promise(resolve =>
            setTimeout(resolve, MESSAGE_DELAY_MS)
          );
        }
      }

      await interaction.editReply(
        `✅ Sent ${sent} ordinary channel message(s).`
      );
    } else {
      // In DMs, send limited interaction follow-up responses.
      const dmLimit = Math.min(limit, 15);

      for (let i = 0; i < dmLimit; i++) {
        await interaction.followUp({
          content: text,
          ephemeral: false,
          allowedMentions: { parse: [] },
        });

        if (i < dmLimit - 1) {
          await new Promise(resolve =>
            setTimeout(resolve, MESSAGE_DELAY_MS)
          );
        }
      }

      await interaction.followUp({
        content: `✅ Sent ${dmLimit} DM response(s). The DM limit is 15 per command.`,
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error("❌ /spam command failed:", error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: "❌ Something went wrong. Check the bot terminal.",
          ephemeral: true,
        });
      }
    } catch (replyError) {
      console.error("❌ Could not send error response:", replyError);
    }
  }
});

client.on("error", error => {
  console.error("❌ Discord client error:", error);
});

(async () => {
  try {
    await registerCommands();
    await client.login(DISCORD_TOKEN);
  } catch (error) {
    console.error("❌ Startup error:", error);
  }
})();
