require("dotenv").config();
const fs = require('fs');
const path = require('path');
const sessionPath = process.env.SESSION_PATH || path.join(__dirname, 'session');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const OpenAI = require('openai');
const yts = require('yt-search');
const axios = require('axios');
const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
let qrCodeData = null;

app.get('/', async (req, res) => {
  if (qrCodeData) {
    const qrImage = await QRCode.toDataURL(qrCodeData);
    res.send(`<h2>Scan this QR with WhatsApp</h2><img src="${qrImage}"/><p>Refresh page if expired</p>`);
  } else {
    res.send('<h2>WhatsApp Connected ✅</h2><p>Client is ready!</p>');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const AXIOS_DEFAULTS = {
  timeout: 60000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*'
  }
};

async function tryRequest(getter, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await getter();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastError;
}

const scoresFilePath = path.join(__dirname, "scores.json");
const maxStartupRetries = Number(process.env.STARTUP_RETRIES || 3);
let isAiEnabled = process.env.AI_ENABLED === "true";
const chatMemory = new Map();
let isBotMuted = process.env.BOT_MUTED === "true";
let userScores = new Map();
const guessGames = new Map();
const quizGames = new Map();
const wordGames = new Map();
const tttGames = new Map();
const mathGames = new Map();
const hangmanGames = new Map();
const hlGames = new Map();
const downloadSelections = new Map();
const adminNumber = process.env.ADMIN_NUMBER || "";
const openRouter = process.env.OPENROUTER_API_KEY
  ? new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    timeout: Number(process.env.AI_TIMEOUT_MS) || 180000,
    defaultHeaders: {
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost",
      "X-Title": process.env.OPENROUTER_APP_NAME || "WhatsApp Bot",
    },
  })
  : null;
const openRouterModel = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
const aiMaxTokens = Number(process.env.AI_MAX_TOKENS || 100);
const lolHumanApiKey = process.env.LOL_HUMAN_API_KEY || "deb666d7ddce58404c68c1d0";
const youtubeApiKey = process.env.YOUTUBE_API_KEY || "AIzaSyC6q6Um4WFgqd755Z5V-sYsuT93A5zrG2k";
let targetLanguage = process.env.TARGET_LANGUAGE || "English";
let aiInstructions =
  process.env.BOT_PERSONALITY ||
  `You're Carson, a 16-19 year old human. NOT a bot. Keep it SUPER short (1-2 sentences max). Use slang: u, rn, fr, ngl, lowkey, bet. Use 0-2 emojis like 😭, 😂, 💀, ✨, 🙏, 🔥. Sound chill and natural. NEVER say "As an AI" or apologize for being a bot. If u don't know something, say "idk lol" or "google it fr". Reply in ${targetLanguage}.`;

console.log(`AI Provider: OpenRouter (Only)`);
console.log(`Model: ${openRouterModel}`);
console.log("Starting WhatsApp client...");

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: sessionPath }),
  puppeteer: {
    headless: true,
    executablePath: puppeteer.executablePath(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--disable-extensions',
      '--single-process'
    ]
  }
});

client.on('auth_failure', msg => {
  console.log('Auth failed:', msg);
});

client.on('disconnected', reason => {
  console.log('Client disconnected:', reason);
});

client.on('qr', async (qr) => {
  qrCodeData = qr;
  console.log('QR ready - Scan the code below in your Render logs:');
  qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
  console.log("WhatsApp authenticated. Waiting for the bot to finish loading...");
});

client.on('ready', () => {
  qrCodeData = null;
  console.log('Bot is ONLINE ✅');
});

client.on("loading_screen", (percent, message) => {
  console.log(`WhatsApp loading: ${percent}% - ${message}`);
});

client.on("change_state", (state) => {
  console.log("WhatsApp state:", state);
});

// Handle graceful shutdown to ensure the browser process is killed
async function handleGracefulShutdown() {
  console.log("\nShutting down WhatsApp client...");
  await client.destroy().catch(() => { });
  process.exit(0);
}

process.on("SIGINT", handleGracefulShutdown);
process.on("SIGTERM", handleGracefulShutdown);

client.on("message_create", async (message) => {
  // Consolidate handlers: process messages from others AND self-created commands
  if (message.fromMe && message.body.startsWith("!")) {
    await handleMessage(message);
  } else if (!message.fromMe) {
    await handleMessage(message);
  }
});

async function handleMessage(message) {
  wrapMessageReplyWithTyping(message);

  const originalText = message.body.trim();
  const text = originalText.toLowerCase();
  const chatId = getChatId(message);
  const isAdmin = isAdminMessage(message);

  // 1. Handle the master bot toggles first
  if (text === "!bot on") {
    if (!isAdmin) {
      await message.reply("nah only the owner can turn me on fr");
      return;
    }

    isBotMuted = false;
    await message.reply("i'm back on ✨ bet");
    return;
  }

  if (text === "!bot off") {
    if (!isAdmin) {
      await message.reply("only the owner can do that 💀");
      return;
    }

    isBotMuted = true;
    isAiEnabled = false;
  }

  // 2. Global Mute Check: If muted, ignore non-admins immediately
  if (isBotMuted && !isAdmin) {
    return;
  }

  // Handle reactions to stickers
  if (message.type === 'sticker') {
    if (await shouldReplyWithAi(message, "", chatId)) {
      await replyWithAi(message, "[The user sent a sticker]");
    }
    return;
  }

  if (message.fromMe && !text.startsWith("!")) {
    return;
  }

  if (
    text === "!help" ||
    text === "!menu" ||
    text === "!menue" ||
    text === "!commands"
  ) {
    await message.reply(getHelpText());
    return;
  }

  // 3. Handle Sticker Maker
  if (text === "!sticker" || text === "!s") {
    let targetMessage = message;
    if (message.hasQuotedMsg) {
      targetMessage = await message.getQuotedMessage();
    }

    if (!targetMessage.hasMedia) {
      await message.reply("yo send a pic or reply to one first lol 😭");
      return;
    }

    try {
      const media = await withTyping(message, () => targetMessage.downloadMedia());
      if (media) {
        await client.sendMessage(chatId, media, {
          sendMediaAsSticker: true,
          stickerName: "Carson Bot Sticker",
          stickerAuthor: "Carson",
        });
      } else {
        await message.reply("nah that media is trippin 💀 try again");
      }
    } catch (err) {
      console.error("Sticker creation error:", err);
      await message.reply("bruh that file is way too big to be a sticker 😭");
    }
    return;
  }

  if (text === "!ownerhelp") {
    if (!isAdmin) {
      await message.reply("only the boss can see these commands fr 💀");
      return;
    }

    await message.reply(getAdminHelpText());
    return;
  }

  if (text === "!score" || text === "!balance" || text === "!coins") {
    const name = await getPlayerName(message);
    const score = userScores.get(getPlayerId(message)) || 0;
    await message.reply(`💰 *${name}*, your balance is: ${score} Carson Coins.`);
    return;
  }

  if (text.startsWith("!chike")) {
    if (!isAdmin) {
      await message.reply("Only the owner can use this command.");
      return;
    }

    const targetName = getCommandBody(originalText);
    const prompt = `Generate a flirty, lighthearted, and funny pick-up line for ${targetName || 'beautiful'}. Make sure it fits the vibe and context of our recent conversation perfectly.`;
    await replyWithAi(message, prompt);
    return;
  }

  if (text === "!top" || text === "!leaderboard" || text === "!rankings") {
    await message.reply(await getLeaderboard());
    return;
  }

  if (text === "!ping") {
    await message.reply("pong");
    return;
  }

  if (text === "!about") {
    await message.reply("This WhatsApp bot was created by Carson. Built with whatsapp-web.js and AI chat support.");
    return;
  }

  if (text === "!rules") {
    await message.reply(
      "Group rules:\n1. Be respectful.\n2. No spam.\n3. No scams or harmful links.\n4. Send clear messages when asking for help.\n5. Follow admin instructions."
    );
    return;
  }

  if (text === "!time") {
    await message.reply(`Bot time: ${new Date().toLocaleString()}`);
    return;
  }

  if (text === "!id") {
    await message.reply(`This chat ID is:\n${chatId}`);
    return;
  }

  if (text === "!groupinfo") {
    await replyWithGroupInfo(message);
    return;
  }

  if (text === "!save" || text === "!viewonce") {
    if (!message.hasQuotedMsg) {
      await message.reply("To save a view-once message, reply to it with *!save*.");
      return;
    }

    const quotedMsg = await message.getQuotedMessage();

    // Check multiple places for the View Once flag, as it can vary
    const isViewOnce =
      quotedMsg.isViewOnce ||
      quotedMsg._data?.isViewOnce ||
      quotedMsg.data?.isViewOnce ||
      quotedMsg.rawData?.isViewOnce;

    if (!quotedMsg.hasMedia) {
      await message.reply("nothing there to save bruh 💀");
      return;
    }

    if (!isViewOnce) {
      await message.reply("thats not even a view-once msg lol");
      return;
    }

    // If it's a view-once media message, attempt to download
    console.log("Attempting to download view-once media...");
    try {
      const media = await withTyping(message, () => quotedMsg.downloadMedia());
      if (media) {
        await client.sendMessage(message.from, media, {
          caption: `got that view-once for u 🙏 from: ${quotedMsg.author || quotedMsg.from}`,
        });
      } else {
        console.error("View-once downloadMedia returned null for:", quotedMsg);
        await message.reply("too late lol its already gone 💀");
      }
    } catch (err) {
      console.error("View-once extraction error:", err);
      console.error("Quoted message details on error:", quotedMsg);
      await message.reply("nah i can't grab that rn, it's expired or sum 😭");
    }
    return;
  }

  if (text === "!request-normal" || text === "!evidence-request") {
    await message.reply(
      "yo resend that normally fr, i can't see view-once stuff 😭"
    );
    return;
  }

  if (text.startsWith("/download ")) {
    const body = getCommandBody(originalText);
    const parts = body.split(/\s+/);
    if (parts.length < 2) {
      await message.reply("u need to tell me what to download and the format (mp3/mp4) fr 💀");
      return;
    }

    const format = parts.pop().toLowerCase();
    const query = parts.join(" ");

    if (!["mp3", "mp4"].includes(format)) {
      await message.reply("yo pick mp3 or mp4 only 🙏");
      return;
    }

    const videos = await withTyping(message, () => searchYouTube(query, 5));
    if (!videos || !videos.length) {
      await message.reply("nothing found lol try another name");
      return;
    }

    if (videos.length > 1) {
      const results = videos.slice(0, 5);
      downloadSelections.set(chatId, { results, format });
      let response = `i found several results for '${query}'. which one do u want? 😭\n\n`;
      results.forEach((v, i) => {
        response += `${i + 1}. ${v.title} [${v.timestamp}]\n`;
      });
      response += `\nreply with */select [number]* bet`;
      await message.reply(response);
      return;
    }

    await sendMediaFromUrl(message, videos[0].url, format === "mp3" ? "audio" : "video");
    return;
  }

  if (text.startsWith("/select ")) {
    const selection = downloadSelections.get(chatId);
    if (!selection) {
      await message.reply("u didnt search for anything yet lol 💀");
      return;
    }

    const num = parseInt(text.split(/\s+/)[1]);
    const index = num - 1;

    if (isNaN(num) || index < 0 || index >= selection.results.length) {
      await message.reply("pick a valid number from the list fr 😭");
      return;
    }

    const video = selection.results[index];
    downloadSelections.delete(chatId);
    await message.reply(`got u. downloading *${video.title}* rn 🔥`);
    await sendMediaFromUrl(message, video.url, selection.format === "mp3" ? "audio" : "video");
    return;
  }

  if (text.startsWith("!dice")) {
    await playDiceDuel(message, text);
    return;
  }

  if (text.startsWith("!hangman") || text.startsWith("!h ")) {
    await playHangman(message, text, chatId);
    return;
  }

  if (text.startsWith("!slots")) {
    await playSlots(message);
    return;
  }

  if (text.startsWith("!hl")) {
    await playHigherLower(message, text, chatId);
    return;
  }

  if (text.startsWith("!roulette")) {
    await playRoulette(message);
    return;
  }

  if (text === "!games") {
    await message.reply(getGamesText());
    return;
  }

  if (text.startsWith("!math")) {
    await playMathChallenge(message, chatId);
    return;
  }

  if (text.startsWith("!solve ")) {
    await solveMath(message, text, chatId);
    return;
  }

  if (text.startsWith("!flip")) {
    await playCoinFlip(message, text);
    return;
  }

  if (text.startsWith("!rps")) {
    await playRockPaperScissors(message, text);
    return;
  }

  if (text.startsWith("!guess")) {
    await playGuessGame(message, text, chatId);
    return;
  }

  if (text === "!quiz") {
    await startQuiz(message, chatId);
    return;
  }

  if (text.startsWith("!answer")) {
    await answerQuiz(message, text, chatId);
    return;
  }

  if (text === "!word") {
    await startWordGame(message, chatId);
    return;
  }

  if (text.startsWith("!unscramble")) {
    await answerWordGame(message, text, chatId);
    return;
  }

  if (text.startsWith("!ttt")) {
    await playTicTacToe(message, text, chatId);
    return;
  }

  if (text.startsWith("!language ")) {
    if (!isAdmin) {
      await message.reply("nah i only speak what the boss tells me 💀");
      return;
    }

    targetLanguage = getCommandBody(originalText);
  }

  if (text.startsWith("!video ")) {
    await sendMediaFromUrl(message, getCommandBody(originalText), "video");
    return;
  }

  if (text.startsWith("!music ") || text.startsWith("!audio ")) {
    await sendMediaFromUrl(message, getCommandBody(originalText), "audio");
    return;
  }

  if (text === "!friendly" || text === "!human" || text === "!personality friendly" || text === "!personality human") {
    if (!isAdmin) {
      await message.reply("only the owner can change my vibe 💀");
      return;
    }

    await setBotPersonality(message, "friendly");
    return;
  }

  if (text === "!romance" || text === "!girlfriend" || text === "!boyfriend") {
    if (!isAdmin) {
      await message.reply("only the owner can change my vibe 💀");
      return;
    }

    await setBotPersonality(message, "romantic");
    return;
  }

  if (text === "!be-me" || text === "!personality carson") {
    if (!isAdmin) {
      await message.reply("only the owner can change my vibe 💀");
      return;
    }

    await setBotPersonality(message, "carson");
    return;
  }

  if (text === "!personality default") {
    if (!isAdmin) {
      await message.reply("only the owner can change my vibe 💀");
      return;
    }

    await setBotPersonality(message, "default");
    return;
  }

  if (text.startsWith("!personality ")) {
    if (!isAdmin) {
      await message.reply("only the owner can change my vibe 💀");
      return;
    }

    await setBotPersonality(message, "custom", originalText.slice("!personality ".length).trim());
    return;
  }

  if (text === "!ai on") {
    if (!isAdmin) {
      await message.reply("only the owner can do that fr");
      return;
    }

    isAiEnabled = true;
    await message.reply("ai is on now bet ✨");
    return;
  }

  if (text === "!ai off") {
    if (!isAdmin) {
      await message.reply("only the owner can do that fr");
      return;
    }

    isAiEnabled = false;
    chatMemory.delete(chatId);
    await message.reply("ai is off now i'm sleep 💤");
    return;
  }

  if (text === "!clearai" || text === "!forget") {
    if (!isAdmin) {
      await message.reply("only the boss can make me forget 💀");
      return;
    }

    chatMemory.delete(chatId);
    await message.reply("forgetting everything rn... wait what was i saying? 😂");
    return;
  }

  if (text === "!ai status") {
    await message.reply(getAiStatusText(chatId));
    return;
  }

  if (text === "!ai test") {
    await replyWithAi(message, "Reply with: AI test OK");
    return;
  }

  if (text.startsWith("!ask ")) {
    await replyWithAi(message, originalText.slice(5).trim());
    return;
  }

  if (await shouldReplyWithAi(message, originalText, chatId)) {
    await replyWithAi(message, originalText);
  }
}

function getChatId(message) {
  return message.fromMe ? message.to : message.from;
}

function isGroupMessage(message) {
  return message.from.endsWith("@g.us") || message.to?.endsWith("@g.us");
}

function getBotMentionIds() {
  const botId = client.info?.wid?._serialized;
  const botUser = client.info?.wid?.user;

  return [botId, botUser ? `${botUser}@c.us` : ""].filter(Boolean);
}

async function isBotMentioned(message) {
  const mentionedIds = message.mentionedIds || [];
  const botMentionIds = getBotMentionIds();

  if (botMentionIds.some((botId) => mentionedIds.includes(botId))) {
    return true;
  }

  // Check if this message is a reply to a message from the bot
  if (message.hasQuotedMsg) {
    try {
      const quotedMsg = await message.getQuotedMessage();
      if (quotedMsg.fromMe) {
        return true;
      }
    } catch (error) {
      // Silent fail for quoted message fetch
    }
  }

  const botUser = client.info?.wid?.user;
  if (
    botUser &&
    mentionedIds.some((id) => id.split("@")[0] === botUser)
  ) {
    return true;
  }

  try {
    const mentions = await message.getMentions();
    return mentions.some((contact) => {
      const contactId = contact.id?._serialized;
      const contactUser = contact.id?.user || contact.number;

      return (
        botMentionIds.includes(contactId) ||
        Boolean(botUser && contactUser === botUser)
      );
    });
  } catch (error) {
    console.log("Could not read message mentions:", getErrorMessage(error));
    return false;
  }
}

async function shouldReplyWithAi(message, text, chatId) {
  if (!isAiEnabled) {
    return false;
  }

  if (!isGroupMessage(message) && (text || message.type === 'sticker')) {
    return true;
  }

  return isBotMentioned(message);
}

function isAdminMessage(message) {
  if (message.fromMe) {
    return true;
  }

  if (!adminNumber) {
    return false;
  }

  const adminChatId = `${adminNumber.replace(/\D/g, "")}@c.us`;
  return message.from === adminChatId || message.author === adminChatId;
}

function isNameQuestion(text) {
  const normalizedText = text.replace(/[^\w\s']/g, " ").replace(/\s+/g, " ");

  return [
    /\bwhat\s+is\s+(your|ur)\s+name\b/,
    /\bwhat's\s+(your|ur)\s+name\b/,
    /\bwhats\s+(your|ur)\s+name\b/,
    /\bwho\s+are\s+you\b/,
    /\btell\s+me\s+(your|ur)\s+name\b/,
    /\bmay\s+i\s+know\s+(your|ur)\s+name\b/,
    /\bcan\s+i\s+know\s+(your|ur)\s+name\b/,
  ].some((pattern) => pattern.test(normalizedText));
}

function getHelpText() {
  return [
    "🟦🟦🟦🟦🟦🟦🟦🟦🟦",
    "🟦   💎 *C A R S O N* 💎   🟦",
    "🟦🟦🟦🟦🟦🟦🟦🟦🟦",
    "",
    "🏮 *CARSON BOT MENU* 🏮",
    "━━━━━━━━━━━━━━━━━━",
    "",
    "️ *GENERAL TOOLS*",
    "▶️ *!menu* : Show this guide",
    "▶️ *!ping* : Check bot status",
    "▶️ *!about* : Bot info",
    "▶️ *!time* : System time",
    "▶️ *!score* : Your balance",
    "▶️ *!top* : Leaderboard",
    "▶️ *!sticker* : Image ➜ Sticker",
    "▶️ *!id* : Current chat ID",
    "",
    "👥 *GROUP UTILS*",
    "▶️ *!rules* : View regulations",
    "▶️ *!groupinfo* : Group details",
    "",
    "🤖 *AI ASSISTANT*",
    "▶️ *!ask [text]* : Quick question",
    "▶️ *!ai status* : Check config",
    "▶️ *!video [url]* : Video download",
    "▶️ *!audio [url]* : Music download",
    "_Note: In groups, tag the bot!_",
    "",
    "🎮 *GAME ZONE*",
    "▶️ *!games* : Play games",
    "",
    "🔐 *OWNERSHIP*",
    "▶️ *!ownerhelp* : Secure commands",
    "",
    "━━━━━━━━━━━━━━━━━━"
  ].join("\n");
}

function getGamesText() {
  return [
    "┏━━━╾ 🎮  *CARSON GAME ZONE*  🎮 ╼━━━┓",
    "┃  _Challenge your brain and your luck!_  ┃",
    "┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛",
    "",
    "🕹️  *ARCADE & LUCK (Gamble!)*",
    "┣ `!rps [move]` - Rock Paper Scissors",
    "┣ `!flip [side]` - Heads or Tails",
    "┣ `!dice [1-6]` - Guess the dice roll",
    "┣ `!slots` - Spin the jackpot machine",
    "┣ `!roulette` - High risk, high reward",
    "┣ `!ttt start` - Start Tic-Tac-Toe",
    "┗ `!ttt join` - Join the current TTT",
    "",
    "🧠  *BRAIN TEASERS*",
    "┣ `!math` - Solve arithmetic challenge",
    "┣ `!hangman start` - Guess the hidden word",
    "┣ `!hl start` - Higher or Lower challenge",
    "┣ `!guess start` - Number 1-10",
    "┣ `!quiz` - Start trivia challenge",
    "┗ `!word` - Unscramble word game",
    "",
    "🎯  *ACTION COMMANDS*",
    "┣ `!h [letter]` - Guess Hangman letter",
    "┣ `!hl [higher/lower]` - Guess HL",
    "┣ `!solve [num]` - Submit math answer",
    "┣ `!answer [a/b/c]` - Submit quiz answer",
    "┣ `!unscramble [word]` - Solve anagram",
    "┣ `!guess [number]` - Submit number guess",
    "┗ `!ttt [1-9]` / `!ttt stop` - Play/End TTT",
    "",
    "🚀 _Earn coins & climb the leaderboard!_"
  ].join("\n");
}

function getAdminHelpText() {
  return [
    "🟪🟪🟪🟪🟪🟪🟪🟪🟪",
    "🟪   💎 *C A R S O N* 💎   🟪",
    "🟪🟪🟪🟪🟪🟪🟪🟪🟪",
    "",
    " *OWNER CONTROL PANEL* 🔐",
    "━━━━━━━━━━━━━━━━━━",
    "",
    "🔘 *BOT STATUS*",
    "▶️ *!bot on* / *off* : Global Toggle",
    "",
    "🧠 *AI SETTINGS*",
    "▶️ *!ai on* / *off* : AI Toggle",
    "▶️ *!clearai* : Wipe memory",
    "▶️ *!chike [name]* : Smart AI lines",
    "▶️ *!language [lang]* : Set language",
    "▶️ *!ai test* : Verify connection",
    "",
    "🎭 *PERSONALITY CONTROL*",
    "▶️ *!friendly* : Warm tone",
    "▶️ *!romance* : Partner tone",
    "▶️ *!be-me* : Set identity",
    "▶️ *!personality [text]* : Custom",
    "▶️ *!personality default* : Reset",
    "",
    "🛡️ *MODERATION TOOLS*",
    "▶️ *!save* : Save view-once",
    "▶️ *!request-normal* : Request media",
    "",
    "━━━━━━━━━━━━━━━━━━"
  ].join("\n");
}

function getAiStatusText(chatId) {
  const lines = [
    isAiEnabled
      ? "AI chat is on globally."
      : "AI chat is off. Use !ask for one question, or send !ai on from the owner account.",
    `Provider: OpenRouter`,
    `Language: ${targetLanguage}`,
  ];

  if (chatId.endsWith("@g.us")) {
    lines.push("Group mode: tag the bot to make AI reply.");
  }
  lines.push(`OpenRouter model: ${openRouterModel}`);

  if (!adminNumber) {
    lines.push("Owner number is not set. Only messages sent from the linked WhatsApp account can use owner commands.");
  }

  return lines.join("\n");
}

async function replyWithGroupInfo(message) {
  const chat = await message.getChat();

  if (!chat.isGroup) {
    await message.reply("bruh this only works in groups ngl 😭");
    return;
  }

  await message.reply(
    [
      `Group: ${chat.name}`,
      `Participants: ${chat.participants.length}`,
      `Chat ID: ${chat.id._serialized}`,
    ].join("\n")
  );
}

async function playRockPaperScissors(message, text) {
  const choices = ["rock", "paper", "scissors"];
  const icons = { rock: "💎", paper: "📜", scissors: "✂️" };
  const name = await getPlayerName(message);
  const player = text.split(/\s+/)[1];

  if (!choices.includes(player)) {
    await message.reply("🔮 _Cast your move: !rps rock, paper, or scissors_");
    return;
  }

  const bot = choices[Math.floor(Math.random() * choices.length)];
  const result =
    player === bot
      ? "✨ _The spells collided! It is a draw._"
      : ((player === "rock" && bot === "scissors") ||
        (player === "paper" && bot === "rock") ||
        (player === "scissors" && bot === "paper"))
        ? `🌟 *Victory! You overpowered my spell, ${name}!* ${updateScore(message, 10)}`
        : `💀 *Defeat! My magic was stronger this time, ${name}.*`;

  await message.reply([
    "🏮 *THE MAGIC DUEL* 🏮",
    "━━━━━━━━━━━━━━━━━━",
    `👤 *You:* ${player} ${icons[player]}`,
    `🧙‍♂️ *Bot:* ${bot} ${icons[bot]}`,
    "━━━━━━━━━━━━━━━━━━",
    result
  ].join("\n"));
}

async function playGuessGame(message, text, chatId) {
  const parts = text.split(/\s+/);
  const action = parts[1];
  const name = await getPlayerName(message);

  if (action === "start") {
    guessGames.set(chatId, {
      number: Math.floor(Math.random() * 10) + 1,
      tries: 0,
    });
    await message.reply([
      "🔮 *THE MYSTIC ORACLE* 🔮",
      `"I have peered into the void and chosen a number between 1 and 10, ${name}..."`,
      "✨ _Make your guess: !guess [number]_"
    ].join("\n"));
    return;
  }

  const game = guessGames.get(chatId);
  const guess = Number(action);

  if (!game) {
    await message.reply("🌑 _The Oracle is sleeping. Start the ritual with !guess start_");
    return;
  }

  if (!Number.isInteger(guess) || guess < 1 || guess > 10) {
    await message.reply("Guess a number from 1 to 10. Example: !guess 5");
    return;
  }

  game.tries += 1;

  if (guess === game.number) {
    guessGames.delete(chatId);
    const reward = updateScore(message, 20);
    await message.reply([
      "✨ *PROPHECY FULFILLED!* ✨",
      `The number was indeed *${game.number}*. It took ${game.tries} visions to see it, ${name}.`,
      reward
    ].join("\n"));
    return;
  }

  await message.reply(guess < game.number ? `📉 _"Too low," the spirits whisper to ${name}..._` : `📈 _"Too high," the winds cry out to ${name}..._`);
}

const quizQuestions = [
  {
    question: "What does CPU stand for?\na. Central Processing Unit\nb. Computer Power Utility\nc. Control Program Unit",
    answer: "a",
  },
  {
    question: "Which planet is known as the Red Planet?\na. Venus\nb. Mars\nc. Jupiter",
    answer: "b",
  },
  {
    question: "What is 9 x 7?\na. 56\nb. 63\nc. 72",
    answer: "b",
  },
  {
    question: "Which language runs in the browser?\na. JavaScript\nb. SQL\nc. C# only",
    answer: "a",
  },
];

async function startQuiz(message, chatId) {
  const quiz = quizQuestions[Math.floor(Math.random() * quizQuestions.length)];
  quizGames.set(chatId, quiz);
  await message.reply([
    "📜 *ANCIENT TRIVIA* 📜",
    "────────────────────",
    quiz.question,
    "────────────────────",
    "🕯️ _Cast your answer: !answer a, b, or c_"
  ].join("\n"));
}

async function answerQuiz(message, text, chatId) {
  const quiz = quizGames.get(chatId);
  const answer = text.split(/\s+/)[1];
  const name = await getPlayerName(message);

  if (!quiz) {
    await message.reply(`🌑 _No scrolls are open, ${name}. Open one with !quiz._`);
    return;
  }

  if (!["a", "b", "c"].includes(answer)) {
    await message.reply(`${name}, please answer with a, b, or c. (e.g., !answer a)`);
    return;
  }

  quizGames.delete(chatId);
  if (answer === quiz.answer) {
    const reward = updateScore(message, 15);
    await message.reply([
      "✨ *WISDOM REVEALED!* ✨",
      `The answer was indeed *${quiz.answer}*. Well played, ${name}.`,
      reward
    ].join("\n"));
  } else {
    await message.reply(`🌑 *The scroll fades...* The correct answer was *${quiz.answer}*, ${name}.`);
  }
}

const scrambleWords = ["whatsapp", "computer", "javascript", "message", "network", "business"];

async function startWordGame(message, chatId) {
  const word = scrambleWords[Math.floor(Math.random() * scrambleWords.length)];
  const scrambled = word
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");

  wordGames.set(chatId, word);
  await message.reply([
    "🧩 *ENCHANTED ANAGRAM* 🧩",
    `"The letters have been jumbled by a chaotic spell!"`,
    "────────────────────",
    `🌀  *${scrambled.toUpperCase()}*`,
    "────────────────────",
    "🗝️ _Break the seal: !unscramble [word]_"
  ].join("\n"));
}

async function answerWordGame(message, text, chatId) {
  const word = wordGames.get(chatId);
  const name = await getPlayerName(message);
  const answer = text.replace("!unscramble", "").trim().toLowerCase();

  if (!word) {
    await message.reply(`🌑 _The letters are settled, ${name}. Jumble them with !word._`);
    return;
  }

  if (!answer) {
    await message.reply("Use: !unscramble youranswer");
    return;
  }

  if (answer === word) {
    wordGames.delete(chatId);
    const reward = updateScore(message, 15);
    await message.reply([
      "✨ *SPELL BROKEN!* ✨",
      `The word was *${word.toUpperCase()}*. You are a master of language, ${name}!`,
      reward
    ].join("\n"));
    return;
  }

  await message.reply(`❌ _"Not quite," the shadows murmur to ${name}. Try again!_`);
}

async function playCoinFlip(message, text) {
  const choice = text.split(/\s+/)[1]?.toLowerCase();
  if (!['heads', 'tails'].includes(choice)) {
    await message.reply([
      "🪙  *COIN FLIP*",
      "━━━━━━━━━━━━━━━━━━",
      "Pick a side to bet your luck!",
      "👉 Use: *!flip heads* or *!flip tails*"
    ].join("\n"));
    return;
  }

  const result = Math.random() > 0.5 ? 'heads' : 'tails';
  const win = choice === result;
  const name = await getPlayerName(message);
  const reward = win ? updateScore(message, 5) : "";

  await message.reply([
    "🪙  *COIN FLIP RESULT*",
    "━━━━━━━━━━━━━━━━━━",
    `The coin spins in the air... it lands on:`,
    `✨  *${result.toUpperCase()}*  ✨`,
    "━━━━━━━━━━━━━━━━━━",
    win ? `🎉 *Luck is on your side, ${name}!* ${reward}` : `💀 *L imagine losing a flip, ${name}.*`
  ].join("\n"));
}

async function playMathChallenge(message, chatId) {
  const ops = ['+', '-', '*'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let n1, n2;

  if (op === '*') {
    n1 = Math.floor(Math.random() * 12) + 1;
    n2 = Math.floor(Math.random() * 12) + 1;
  } else {
    n1 = Math.floor(Math.random() * 50) + 1;
    n2 = Math.floor(Math.random() * 50) + 1;
  }

  const answer = op === '+' ? n1 + n2 : op === '-' ? n1 - n2 : n1 * n2;
  mathGames.set(chatId, answer);

  await message.reply([
    "🧮  *MATH CHALLENGE*  🧮",
    "━━━━━━━━━━━━━━━━━━",
    `Quick! Solve this expression:`,
    "",
    `⚡  *${n1} ${op === '*' ? '×' : op} ${n2} = ?*`,
    "",
    "━━━━━━━━━━━━━━━━━━",
    "🗝️ _Type: *!solve [answer]*_"
  ].join("\n"));
}

async function solveMath(message, text, chatId) {
  const correctAnswer = mathGames.get(chatId);
  if (correctAnswer === undefined) {
    await message.reply("🌑 _No math challenge is active. Start one with !math_");
    return;
  }

  const userAnswer = parseInt(text.split(/\s+/)[1]);
  const name = await getPlayerName(message);

  if (userAnswer === correctAnswer) {
    mathGames.delete(chatId);
    const reward = updateScore(message, 10);
    await message.reply([
      "✅  *CALCULATION COMPLETE!*",
      `*${correctAnswer}* is correct! Your brain is huge, ${name}.`,
      reward
    ].join("\n"));
  } else {
    await message.reply(`❌ _"Wrong numbers," the spirits whisper to ${name}. Try again!_`);
  }
}

async function playDiceDuel(message, text) {
  const guess = parseInt(text.split(/\s+/)[1]);
  const name = await getPlayerName(message);

  if (isNaN(guess) || guess < 1 || guess > 6) {
    await message.reply("🎲 _Pick a number between 1 and 6! Use: !dice 4_");
    return;
  }

  const roll = Math.floor(Math.random() * 6) + 1;
  const win = guess === roll;
  const reward = win ? updateScore(message, 30) : "";

  await message.reply([
    "🎲  *DICE ROLL*",
    "━━━━━━━━━━━━━━━━━━",
    `The dice bounces on the table...`,
    `It's a:  *${roll}*`,
    "━━━━━━━━━━━━━━━━━━",
    win ? `🌟 *Incredible guess, ${name}!* ${reward}` : `💀 *Wrong number, ${name}. Better luck next time.*`
  ].join("\n"));
}

async function playHangman(message, text, chatId) {
  const words = ["diamond", "phoenix", "galaxy", "starlight", "mystery", "paradox", "whisper", "shadow", "legend", "arcane"];
  const name = await getPlayerName(message);

  if (text.startsWith("!hangman start")) {
    const word = words[Math.floor(Math.random() * words.length)];
    hangmanGames.set(chatId, { word, guessed: [], lives: 6 });
    await message.reply([
      "😵  *HANGMAN: THE GALLOWS*",
      "━━━━━━━━━━━━━━━━━━",
      `A word has been chosen from the void...`,
      "",
      `📜  *${"_ ".repeat(word.length).trim()}*`,
      "",
      "❤️ Lives: 6",
      "━━━━━━━━━━━━━━━━━━",
      "👉 _Guess a letter: *!h [letter]*_"
    ].join("\n"));
    return;
  }

  const game = hangmanGames.get(chatId);
  if (!game) {
    await message.reply("🌑 _The gallows are empty. Start with !hangman start_");
    return;
  }

  const letter = text.replace("!h ", "").trim().toLowerCase();
  if (letter.length !== 1 || !/[a-z]/.test(letter)) {
    await message.reply("Guess one letter at a time, dummy! Example: !h a");
    return;
  }

  if (game.guessed.includes(letter)) {
    await message.reply(`You already guessed '${letter.toUpperCase()}', ${name}. Try another.`);
    return;
  }

  game.guessed.push(letter);
  const display = game.word.split("").map(l => game.guessed.includes(l) ? l.toUpperCase() : "_").join(" ");

  if (game.word.includes(letter)) {
    if (!display.includes("_")) {
      hangmanGames.delete(chatId);
      const reward = updateScore(message, 50);
      await message.reply(`🏆 *YOU SURVIVED!* The word was *${game.word.toUpperCase()}*. ${reward}`);
    } else {
      await message.reply([
        "✅ *Correct!*",
        `📜  *${display}*`,
        `❤️ Lives: ${game.lives}`
      ].join("\n"));
    }
  } else {
    game.lives -= 1;
    if (game.lives <= 0) {
      hangmanGames.delete(chatId);
      await message.reply(`💀 *GAME OVER.* The gallows claim another victim. The word was *${game.word.toUpperCase()}*.`);
    } else {
      await message.reply([
        "❌ *Wrong letter!*",
        `📜  *${display}*`,
        `❤️ Lives: ${game.lives}`
      ].join("\n"));
    }
  }
}

async function playSlots(message) {
  const emojis = ['🍒', '🍋', '🍇', '💎', '🔔'];
  const s1 = emojis[Math.floor(Math.random() * emojis.length)];
  const s2 = emojis[Math.floor(Math.random() * emojis.length)];
  const s3 = emojis[Math.floor(Math.random() * emojis.length)];
  const name = await getPlayerName(message);

  let result = "";
  if (s1 === s2 && s2 === s3) {
    result = `🎰 *JACKPOT!!!* You won 100 coins! ${updateScore(message, 100)}`;
  } else if (s1 === s2 || s2 === s3 || s1 === s3) {
    result = `✨ *Small Win!* You won 20 coins! ${updateScore(message, 20)}`;
  } else {
    result = `🌑 _The reels stop... no match today, ${name}. Try again!_`;
  }

  await message.reply([
    "🎰  *CARSON SLOTS*  🎰",
    "━━━━━━━━━━━━━━━━━━",
    `      [ ${s1} | ${s2} | ${s3} ]`,
    "━━━━━━━━━━━━━━━━━━",
    result
  ].join("\n"));
}

async function playHigherLower(message, text, chatId) {
  const name = await getPlayerName(message);

  if (text.startsWith("!hl start")) {
    const startNum = Math.floor(Math.random() * 13) + 1;
    hlGames.set(chatId, startNum);
    await message.reply([
      "🃏  *HIGHER OR LOWER*",
      "━━━━━━━━━━━━━━━━━━",
      `Current number is:  *${startNum}*`,
      "",
      "Will the next number be Higher or Lower?",
      "👉 _Use: *!hl higher* or *!hl lower*_"
    ].join("\n"));
    return;
  }

  const current = hlGames.get(chatId);
  if (!current) {
    await message.reply("🌑 _The deck is put away. Start with !hl start_");
    return;
  }

  const guess = text.includes("higher") ? "higher" : text.includes("lower") ? "lower" : null;
  if (!guess) {
    await message.reply("Please guess 'higher' or 'lower'!");
    return;
  }

  const next = Math.floor(Math.random() * 13) + 1;
  hlGames.delete(chatId);

  const win = (guess === "higher" && next > current) || (guess === "lower" && next < current);
  const draw = next === current;

  let resultText = "";
  if (draw) {
    resultText = `✨ *It's a tie!* Both numbers were ${next}. No one wins.`;
  } else if (win) {
    resultText = `🎉 *Spot on, ${name}!* It was ${next}. ${updateScore(message, 15)}`;
  } else {
    resultText = `💀 *Unlucky, ${name}.* It was ${next}.`;
  }

  await message.reply([
    "🃏  *HL RESULT*",
    "━━━━━━━━━━━━━━━━━━",
    `Previous: *${current}*`,
    `Next: *${next}*`,
    "━━━━━━━━━━━━━━━━━━",
    resultText
  ].join("\n"));
}

async function playRoulette(message) {
  const name = await getPlayerName(message);
  const dead = Math.floor(Math.random() * 6) === 0;

  await message.reply("🔫 _The cylinder spins... you pull the trigger..._");
  await wait(2000);

  if (dead) {
    updateScore(message, -50);
    await message.reply([
      "💥  *BANG!*",
      "━━━━━━━━━━━━━━━━━━",
      `You took a bullet to the wallet, ${name}.`,
      "💰 *Loss: -50 Carson Coins*"
    ].join("\n"));
  } else {
    await message.reply([
      "📸  *CLICK.*",
      "━━━━━━━━━━━━━━━━━━",
      `You survived the round, ${name}. The spirits reward your courage.`,
      updateScore(message, 15)
    ].join("\n"));
  }
}

async function playTicTacToe(message, text, chatId) {
  const action = text.split(/\s+/)[1];
  const playerId = getPlayerId(message);
  const playerName = await getPlayerName(message);
  const game = tttGames.get(chatId);

  if (action === "start") {
    if (game) {
      await message.reply("A tic-tac-toe game is already running. Use !ttt to view it or !ttt stop to stop it.");
      return;
    }

    tttGames.set(chatId, {
      board: Array(9).fill(null),
      players: {
        X: playerId,
        O: null,
      },
      names: {
        X: playerName,
        O: null,
      },
      turn: "X",
    });
    await message.reply([
      "🧙‍♂️ *WIZARD'S CHESS: Tic-Tac-Toe* 🧙‍♂️",
      "",
      `❌ *X*: ${playerName}`,
      "⭕ *O*: _Waiting for challenger..._",
      "",
      formatBoard(tttGames.get(chatId).board),
      "",
      "✨ Another player, send *!ttt join* to enter!"
    ].join("\n"));
    return;
  }

  if (action === "stop") {
    tttGames.delete(chatId);
    await message.reply("🌑 _The board vanishes into the mist._");
    return;
  }

  if (!game) {
    await message.reply("🌑 _The board is empty. Invoke !ttt start_");
    return;
  }

  if (!action) {
    await message.reply(
      `${formatBoard(game.board)}\n\nX: ${game.names.X}\nO: ${game.names.O || "waiting"}\nTurn: ${game.turn}\nUse: !ttt 1`
    );
    return;
  }

  if (action === "join") {
    if (game.players.X === playerId) {
      await message.reply("You already started this game as X. Another person must join as O.");
      return;
    }

    if (game.players.O) {
      await message.reply("🌑 _This duel already has two wizards._");
      return;
    }

    game.players.O = playerId;
    game.names.O = playerName;
    await message.reply([
      "🤝 *Challenger Entered!*",
      "",
      `❌ *X*: ${game.names.X}`,
      `⭕ *O*: ${game.names.O}`,
      "",
      formatBoard(game.board),
      "",
      `🚩 ${game.names.X}, the first move is yours! Use *!ttt [1-9]*`
    ].join("\n"));
    return;
  }

  if (!game.players.O) {
    await message.reply("⏳ _Waiting for a worthy opponent. Send !ttt join_");
    return;
  }

  const symbol = game.players.X === playerId ? "X" : game.players.O === playerId ? "O" : null;

  if (!symbol) {
    await message.reply("🌑 _You are but an observer to this duel._");
    return;
  }

  if (symbol !== game.turn) {
    await message.reply(`It is not your turn. Current turn: ${game.turn}`);
    return;
  }

  const move = Number(action);

  if (!Number.isInteger(move) || move < 1 || move > 9) {
    await message.reply("🔮 _Choose a position between 1 and 9._");
    return;
  }

  const index = move - 1;

  if (game.board[index]) {
    await message.reply("🌑 _That position is already enchanted. Choose another._");
    return;
  }

  game.board[index] = symbol;

  if (await finishTicTacToeIfDone(message, chatId, game)) {
    return;
  }

  game.turn = symbol === "X" ? "O" : "X";
  await message.reply([
    `${symbol === "X" ? "❌" : "⭕"} *${playerName}* enchanted position *${move}*.`,
    "",
    formatBoard(game.board),
    "",
    `👉 Turn: *${game.turn}* (${game.names[game.turn]})`
  ].join("\n"));
}

async function finishTicTacToeIfDone(message, chatId, game) {
  const board = game.board;
  const winner = getTicTacToeWinner(board);

  if (winner) {
    const winnerId = game.players[winner];
    const winnerName = game.names[winner];
    // Manually add score since we have the winner's specific ID
    const currentScore = userScores.get(winnerId) || 0;
    userScores.set(winnerId, currentScore + 30);

    tttGames.delete(chatId);
    await message.reply([
      "🏆 *Match Concluded!* 🏆",
      "",
      `👑 *Winner:* ${winnerName} (${winner === "X" ? "❌" : "⭕"})`,
      "",
      formatBoard(board),
      "",
      "💰 Bounty: *+30 coins*"
    ].join("\n"));
    return true;
  }

  if (board.every(Boolean)) {
    tttGames.delete(chatId);
    await message.reply([
      "🤝 *It's a Draw!* 🤝",
      "",
      formatBoard(board),
      "",
      "✨ _The magic was perfectly balanced._"
    ].join("\n"));
    return true;
  }

  return false;
}

function getTicTacToeWinner(board) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];

  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }

  return null;
}

function formatBoard(board) {
  const numberEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
  const cells = board.map((value, index) => {
    if (value === "X") return "❌";
    if (value === "O") return "⭕";
    return numberEmojis[index];
  });

  return [
    `${cells[0]} ┃ ${cells[1]} ┃ ${cells[2]}`,
    `━━╋━━╋━━`,
    `${cells[3]} ┃ ${cells[4]} ┃ ${cells[5]}`,
    `━━╋━━╋━━`,
    `${cells[6]} ┃ ${cells[7]} ┃ ${cells[8]}`
  ].join("\n");
}

function getPlayerId(message) {
  if (message.author) {
    return message.author;
  }

  return message.fromMe ? "admin" : message.from;
}

async function getPlayerName(message) {
  if (message.fromMe) {
    return "Owner";
  }

  const contact = await message.getContact();
  return contact.pushname || contact.name || contact.number || getPlayerId(message);
}

function wrapMessageReplyWithTyping(message) {
  if (message.__typingWrapped) {
    return;
  }

  const originalReply = message.reply.bind(message);
  message.reply = async (...args) => {
    await showTyping(message);
    message.__hasWaitedReading = true; // Mark that reading delay has occurred for this message
    return originalReply(...args);
  };
  message.__typingWrapped = true;
}

async function showTyping(message, durationMs = 1000) {
  try {
    const chat = await message.getChat();
    await setChatPresence(chat, 'composing');
    await wait(durationMs);
    await setChatPresence(chat, 'available');
  } catch (error) {
    console.log("Could not show typing state:", getErrorMessage(error));
  }
}

async function withTyping(message, task) {
  let chat = null;
  let interval = null;

  try {
    chat = await message.getChat();
    await setChatPresence(chat, 'composing');
    interval = setInterval(() => {
      setChatPresence(chat, 'composing').catch(() => { });
    }, 8000);
  } catch (error) {
    console.log("Could not keep typing state:", getErrorMessage(error));
  }

  try {
    // Optimized typing simulation for faster AI responses
    const [result] = await Promise.all([task(), wait(1200)]);
    return result;
  } finally {
    if (interval) {
      clearInterval(interval);
    }

    if (chat) {
      await setChatPresence(chat, 'available');
    }
  }
}

// Helper to set chat presence robustly across different whatsapp-web.js versions
async function setChatPresence(chat, state) {
  if (!chat) {
    // console.warn("Attempted to set presence on a null/undefined chat object.");
    return;
  }

  if (typeof chat.sendPresence === 'function') {
    await chat.sendPresence(state).catch(err => console.warn(`Failed to set presence via sendPresence(${state}): ${err.message}`));
  } else if (state === 'composing' && typeof chat.sendStateTyping === 'function') {
    await chat.sendStateTyping().catch(err => console.warn(`Failed to set typing state: ${err.message}`));
  } else if (state === 'available' && typeof chat.clearState === 'function') {
    await chat.clearState().catch(err => console.warn(`Failed to clear typing state: ${err.message}`));
  } else {
    // console.warn(`Chat object does not support presence/typing methods for state: ${state}`);
  }
}

function getCommandBody(text) {
  return text.split(/\s+/).slice(1).join(" ").trim();
}

async function searchYouTube(query, maxResults = 1) {
  if (!youtubeApiKey) {
    throw new Error("YOUTUBE_API_KEY is missing from .env fr 💀");
  }
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=${maxResults}&key=${youtubeApiKey}`;
  const res = await axios.get(url, AXIOS_DEFAULTS);
  return (res.data.items || []).map(item => ({
    title: item.snippet?.title || "Video",
    url: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
    timestamp: "N/A"
  }));
}

async function getKeithAudio(youtubeUrl) {
  // Standard endpoint for Keith API
  const apiUrl = `https://keith-api.vercel.app/api/download/ytmp3?url=${encodeURIComponent(youtubeUrl)}`;
  const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
  if (res?.data?.status && res?.data?.result?.downloadUrl) {
    return { download: res.data.result.downloadUrl, title: res.data.result.title };
  }
  throw new Error('Keith API failed');
}

async function getLolHumanAudio(youtubeUrl, apiKey) {
  const apiUrl = `https://api.lolhuman.xyz/api/yt2mp3?apikey=${apiKey || 'freekey'}&url=${encodeURIComponent(youtubeUrl)}`;
  const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
  if (res?.data?.status === 200 && res?.data?.result?.link) {
    return { download: res.data.result.link, title: res.data.result.title };
  }
  throw new Error('LolHuman API failed');
}

async function sendMediaFromUrl(message, query, kind) {
  if (!query) {
    await message.reply(`Use: !${kind === "video" ? "video" : "music"} [name or url]`);
    return;
  }

  try {
    let url = query;
    let videoData = null;

    if (!isHttpUrl(query)) {
      const videos = await searchYouTube(query, 1);
      if (!videos || !videos.length) {
        await message.reply(`No results found for "${query}"`);
        return;
      }
      videoData = videos[0];
      url = videoData.url;
      await message.reply(`🔎 Found: *${videoData.title}*\n⏳ Sending directly...`);
    }

    let downloadUrl = null;
    let finalTitle = videoData?.title || "Media";

    const apiMethods = [
      { name: 'Keith', method: () => getKeithAudio(url) },
      { name: 'LolHuman', method: () => getLolHumanAudio(url, lolHumanApiKey) }
    ];

    for (const api of apiMethods) {
      try {
        const data = await api.method();
        if (data.download) {
          downloadUrl = data.download;
          finalTitle = data.title || finalTitle;
          console.log(`📥 [${kind.toUpperCase()}] Success via source: ${api.name}`);
          break;
        }
      } catch (e) {
        console.error(`[${kind.toUpperCase()}] ${api.name} failed: ${e.message}`);
        continue;
      }
    }

    if (!downloadUrl) {
      console.error(`[DOWNLOAD] Both Keith and LolHuman failed for: ${url}`);
      throw new Error('All download sources failed. The APIs might be down or the video is restricted.');
    }

    const mediaRes = await withTyping(message, () => axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        ...AXIOS_DEFAULTS.headers,
        'Accept-Encoding': 'identity'
      }
    }));

    const buffer = Buffer.from(mediaRes.data);
    const firstBytes = buffer.slice(0, 12);
    const hexSignature = firstBytes.toString('hex');
    const asciiSignature = firstBytes.toString('ascii', 4, 8);

    let mimetype = kind === "video" ? 'video/mp4' : 'audio/mpeg';
    let extension = kind === "video" ? 'mp4' : 'mp3';

    if (kind === "audio") {
      if (asciiSignature === 'ftyp' || hexSignature.startsWith('000000')) {
        mimetype = 'audio/mp4';
        extension = 'm4a';
      } else if (buffer.toString('ascii', 0, 4) === 'OggS') {
        mimetype = 'audio/ogg; codecs=opus';
        extension = 'ogg';
      }
    }

    const media = new MessageMedia(mimetype, buffer.toString("base64"), `${finalTitle.replace(/[^\w\s-]/g, '')}.${extension}`);

    const chatId = getChatId(message);
    await client.sendMessage(chatId, media, {
      sendAudioAsVoice: false,
      caption: finalTitle,
      quotedMessageId: message.id._serialized
    });

  } catch (error) {
    console.error(`${kind} direct download failed:`, error);
    await message.reply(`❌ Could not download ${kind}. Error: ${error.message}`);
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function setBotPersonality(message, mode, customPersonality = "") {
  const basePersonality = `You're Carson, a 16-19 year old human. NOT a bot. Keep it SUPER short (1-2 sentences max). Use slang: u, rn, fr, ngl, lowkey, bet. Use 0-2 emojis like 😭, 😂, 💀, ✨, 🙏, 🔥. Sound chill and natural. NEVER say "As an AI" or apologize for being a bot. If u don't know something, say "idk lol" or "google it fr". IMPORTANT: You must ONLY reply in ${targetLanguage}.`;

  if (mode === "friendly") {
    aiInstructions = `${basePersonality} Be extra nice and chill. Talk like a good friend.`;
  } else if (mode === "romantic") {
    aiInstructions = `${basePersonality} Be flirty and sweet. Act like u r catching feelings.`;
  } else if (mode === "carson") {
    aiInstructions = basePersonality;
  } else if (mode === "default") {
    aiInstructions = basePersonality;
  } else {
    if (!customPersonality) {
      await message.reply("Use: !personality chat like a friendly big brother who gives short helpful answers");
      return;
    }

    aiInstructions = `${basePersonality} ${customPersonality}`;
  }

  chatMemory.clear();
  await message.reply(`Done. I will use that personality for future AI replies in ${targetLanguage}.`);
}

async function replyWithAi(message, prompt) {
  if (!openRouter) {
    await message.reply(
      "AI is not set up yet. Add your OPENROUTER_API_KEY in a .env file, then restart the bot."
    );
    return;
  }

  if (!prompt) {
    await message.reply("Send a question after the command, like: !ask write a birthday message");
    return;
  }

  try {
    const chatId = getChatId(message);
    const memory = chatMemory.get(chatId) || [];
    const messages = [
      ...memory,
      {
        role: "user",
        content: prompt,
      },
    ];

    const aiAnswer = await withTyping(message, () => createAiReply(messages));

    chatMemory.set(chatId, [
      ...messages.slice(-8),
      {
        role: "assistant",
        content: aiAnswer,
      },
    ]);

    await message.reply(aiAnswer.slice(0, 3500));
  } catch (error) {
    console.error("AI reply failed:", error);
    const errorMessage = getErrorMessage(error);

    if (error.code === "insufficient_quota") {
      await message.reply("yo my ai ran out of money 😭 tell the boss");
      return;
    }

    if (error.name === "APIConnectionTimeoutError") {
      await message.reply("ai is laggy rn... try again in a bit 🙏");
      return;
    }

    if (error.status === 429) {
      await message.reply("getting too many msgs 💀 chill for a sec");
      return;
    }

    await message.reply("ai is trippin rn 😭 idk what happened");
  }
}

async function createAiReply(messages) {
  return createOpenRouterReply(messages);
}

async function createOpenRouterReply(messages) {
  const response = await openRouter.chat.completions.create({
    model: openRouterModel,
    messages: [
      {
        role: "system",
        content: aiInstructions,
      },
      ...messages,
    ],
    max_tokens: aiMaxTokens,
  });

  return response.choices?.[0]?.message?.content?.trim() || "I could not make a reply this time.";
}

function updateScore(message, amount) {
  const userId = getPlayerId(message);
  const currentScore = userScores.get(userId) || 0;
  const newScore = currentScore + amount;
  userScores.set(userId, newScore);
  saveScores();

  return `(+${amount} Carson Coins)`;
}

function loadScores() {
  try {
    if (fs.existsSync(scoresFilePath)) {
      const data = fs.readFileSync(scoresFilePath, "utf8");
      const parsed = JSON.parse(data);
      userScores = new Map(Object.entries(parsed));
      console.log("Loaded user scores from disk.");
    }
  } catch (err) {
    console.error("Failed to load scores:", err);
  }
}

function saveScores() {
  try {
    const data = JSON.stringify(Object.fromEntries(userScores));
    fs.writeFileSync(scoresFilePath, data, "utf8");
  } catch (err) {
    console.error("Failed to save scores:", err);
  }
}

async function getLeaderboard() {
  if (userScores.size === 0) {
    return "🏆 *CARSON COIN LEADERBOARD*\n\nNo scores recorded yet. Start playing games to earn coins!";
  }

  const sorted = Array.from(userScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const lines = ["🏆 *CARSON COIN LEADERBOARD*", ""];

  for (let i = 0; i < sorted.length; i++) {
    const [id, score] = sorted[i];
    let name = "";

    if (id === "admin") {
      name = "Owner";
    } else {
      try {
        const contact = await client.getContactById(id);
        name = contact.pushname || contact.name || contact.number || "Player";
      } catch {
        name = id.split("@")[0];
      }
    }

    const rank = i + 1;
    let emoji = "🔹";
    if (rank === 1) emoji = "🥇";
    else if (rank === 2) emoji = "🥈";
    else if (rank === 3) emoji = "🥉";

    lines.push(`${emoji} ${rank}. *${name}* - ${score} coins`);
  }

  return lines.join("\n");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error) {
  if (typeof error === "string") {
    return error;
  }

  return error?.message || String(error);
}

async function startClient(attempt = 1) {
  try {
    if (attempt === 1) {
      loadScores();

      // Try to clear any orphaned lock before the first attempt
      const lockPath = path.join(__dirname, ".wwebjs_auth", "session", "SingletonLock");
      if (fs.existsSync(lockPath)) {
        try { fs.unlinkSync(lockPath); } catch (e) { /* ignore */ }
      }
    }

    await client.initialize();
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    const retryableStartupErrors = [
      "auth timeout",
      "Execution context was destroyed",
      "net::ERR_CONNECTION_RESET",
      "net::ERR_NETWORK_CHANGED",
      "net::ERR_TIMED_OUT",
      "Navigation timeout",
      "browser is already running",
    ];
    const canRetry =
      attempt < maxStartupRetries &&
      retryableStartupErrors.some((message) =>
        errorMessage.includes(message)
      );

    if (!canRetry) {
      console.error("WhatsApp client failed to start:", error);
      return; // Do NOT exit the process. Let the Express server continue running.
    }

    // Ensure previous browser instances are killed before clearing locks
    console.log("Shutting down previous browser instance...");
    await client.destroy().catch(() => { });
    await wait(2000);

    // If the browser is locked, attempt to clear the lock file before retrying
    if (errorMessage.includes("browser is already running")) {
      const lockPath = path.join(__dirname, ".wwebjs_auth", "session", "SingletonLock");
      try {
        if (fs.existsSync(lockPath)) {
          console.log("Force-clearing session lock file...");
          fs.unlinkSync(lockPath);
        }
      } catch (err) {
        console.error("\x1b[31m%s\x1b[0m", "CRITICAL ERROR: Could not clear the session lock.");
        console.error("A Chrome process is still running. Please open Task Manager and end all 'Google Chrome' or 'Chromium' tasks.");
      }
    }

    console.log(
      `WhatsApp startup failed with a retryable error. Retrying in 5 seconds (${attempt}/${maxStartupRetries})...`
    );
    await wait(3000);
    await startClient(attempt + 1);
  }
}

startClient();
