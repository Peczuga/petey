require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const cors = require('cors');
const fs = require('fs');

// ── persistence ──────────────────────────────────────────────────────────────
const STATE_FILE = './state.json';

const DEFAULT_STATE = {
  status: 'idle',          // idle | running | paused | stopped
  startTimestamp: null,    // ms – when the current running session began
  totalElapsedMs: 0,       // ms accumulated before current session
  pausedAt: null,          // ms – when paused
  raidedBases: [],         // array of ISO timestamp strings
  unraidedBases: [],       // array of ISO timestamp strings
  skellies: [],            // array of { count, timestamp }
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (_) {}
  return { ...DEFAULT_STATE };
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

let state = loadState();

// ── helpers ───────────────────────────────────────────────────────────────────
function now() { return Date.now(); }

function currentElapsedMs() {
  if (state.status === 'running' && state.startTimestamp) {
    return state.totalElapsedMs + (now() - state.startTimestamp);
  }
  return state.totalElapsedMs;
}

function statsPayload() {
  const elapsedMs = currentElapsedMs();
  const totalSkellies = state.skellies.reduce((s, e) => s + e.count, 0);
  const raidedCount   = state.raidedBases.length;
  const unraidedCount = state.unraidedBases.length;

  const estimatedProfit = (raidedCount * 500_000) + (unraidedCount * 5_000_000) + (totalSkellies * 5_000_000);
  const profitPerHour   = elapsedMs > 0
    ? (estimatedProfit / (elapsedMs / 1000)) * 3600
    : 0;

  return {
    status: state.status,
    elapsedMs,
    raidedBases:   state.raidedBases,
    unraidedBases: state.unraidedBases,
    skellies:      state.skellies,
    totalSkellies,
    estimatedProfit,
    profitPerHour,
  };
}

// ── discord bot ───────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`✅  Bot logged in as ${client.user.tag}`);
});

client.on('messageCreate', (msg) => {
  if (msg.author.bot) return;

  const ch = msg.channel.name?.toLowerCase();
  const ts = new Date().toISOString();

  switch (ch) {
    case 'start': {
      state.status         = 'running';
      state.startTimestamp = now();
      // reset everything on a fresh start
      state.totalElapsedMs = 0;
      state.pausedAt       = null;
      state.raidedBases    = [];
      state.unraidedBases  = [];
      state.skellies       = [];
      console.log('▶  Session started');
      break;
    }

    case 'stop': {
      state.totalElapsedMs = currentElapsedMs();
      state.status         = 'stopped';
      state.startTimestamp = null;
      state.pausedAt       = null;
      console.log('⏹  Session stopped');
      break;
    }

    case 'pause': {
      if (state.status === 'paused') {
        // unpause
        const pausedDuration = now() - state.pausedAt;
        // we do NOT add paused duration to elapsed; startTimestamp stays, just shift it
        state.startTimestamp = state.startTimestamp + pausedDuration;
        state.status   = 'running';
        state.pausedAt = null;
        console.log('▶  Session unpaused');
      } else if (state.status === 'running') {
        state.totalElapsedMs = currentElapsedMs();
        state.startTimestamp = null;
        state.pausedAt = now();
        state.status   = 'paused';
        console.log('⏸  Session paused');
      }
      break;
    }

    case 'raided': {
      state.raidedBases.push(ts);
      console.log(`🔴  Raided base #${state.raidedBases.length}`);
      break;
    }

    case 'unraided': {
      state.unraidedBases.push(ts);
      console.log(`🟢  Unraided base #${state.unraidedBases.length}`);
      break;
    }

    case 'skellies': {
      const count = parseInt(msg.content.trim(), 10);
      if (!isNaN(count) && count > 0) {
        state.skellies.push({ count, timestamp: ts });
        console.log(`💀  Skellies +${count}`);
      } else {
        console.warn(`⚠️  Could not parse skelly count from: "${msg.content}"`);
      }
      break;
    }

    default:
      return; // ignore other channels
  }

  saveState();
});

client.login(process.env.DISCORD_TOKEN);

// ── express API ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors()); // allow your GitHub Pages domain

app.get('/api/stats', (_req, res) => {
  res.json(statsPayload());
});

// health check
app.get('/', (_req, res) => res.send('DonutSMP tracker running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐  API listening on port ${PORT}`));
