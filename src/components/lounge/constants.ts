import type { Sticker } from "./types";
import { getAudioContext } from "../../lib/audio";

// Nigerian WhatsApp Meme Stickers
import bringYourPlateSticker from "../../assets/images/bring_your_plate_sticker_1783328602603.jpg";
import eggZactlySticker from "../../assets/images/egg_zactly_sticker_1783328613445.jpg";
import gbemidebeSticker from "../../assets/images/gbemidebe_sticker_1783328591091.jpg";
import idiotGoatSticker from "../../assets/images/idiot_goat_sticker_1783328576437.jpg";
import okNotedSticker from "../../assets/images/ok_noted_sticker_1783328622945.jpg";
import takeTimeSticker from "../../assets/images/take_time_sticker_1783328542659.jpg";
import talkAmAgainSticker from "../../assets/images/talk_am_again_sticker_1783328563690.jpg";
import youSaySticker from "../../assets/images/you_say_sticker_1783328552772.jpg";

export const STICKER_PACK: Sticker[] = [
  // Nigerian WhatsApp Memes
  { id: "take_time", imageUrl: takeTimeSticker, label: "Take Time", desc: "Nigerian take time caution", category: "meme" },
  { id: "you_say", imageUrl: youSaySticker, label: "You Say?", desc: "Skeptical questioning woman", category: "meme" },
  { id: "talk_am_again", imageUrl: talkAmAgainSticker, label: "Talk am again", desc: "Stern warning gun man", category: "meme" },
  { id: "idiot_goat", imageUrl: idiotGoatSticker, label: "Idiot!", desc: "Smiling funny goat meme", category: "meme" },
  { id: "gbemidebe", imageUrl: gbemidebeSticker, label: "Gbemidebe!", desc: "Pepe green frog singing shouting", category: "meme" },
  { id: "bring_your_plate", imageUrl: bringYourPlateSticker, label: "Bring Plate", desc: "Serving big jollof pot", category: "meme" },
  { id: "egg_zactly", imageUrl: eggZactlySticker, label: "Egg-zactly", desc: "Pepe chick egg zactly", category: "meme" },
  { id: "ok_noted", imageUrl: okNotedSticker, label: "Ok Noted", desc: "Bold thumbs up reaction", category: "meme" },

  // Emojis Category
  { id: "crown", emoji: "👑", label: "Crown", desc: "Royal victory!", category: "emoji" },
  { id: "mindblown", emoji: "🤯", label: "Mindblown", desc: "Epic sequence!", category: "emoji" },
  { id: "fire", emoji: "🔥", label: "On Fire", desc: "Sizzling tactics!", category: "emoji" },
  { id: "galaxy_brain", emoji: "🧠", label: "Galaxy Brain", desc: "1000 IQ move!", category: "emoji" },
  { id: "double_jump", emoji: "🎯", label: "Double Jump", desc: "Savage capture!", category: "emoji" },
  { id: "salute", emoji: "🫡", label: "Respect", desc: "Honorable play!", category: "emoji" },
  { id: "cry", emoji: "😭", label: "Blunder Cry", desc: "Oops, lost the piece!", category: "emoji" },
  { id: "cool", emoji: "😎", label: "Calculated", desc: "Pure precision!", category: "emoji" },
  { id: "handshake", emoji: "🤝", label: "Good Game", desc: "Excellent match!", category: "emoji" },
  { id: "clapping", emoji: "👏", label: "Applause", desc: "Masterful move!", category: "emoji" },
  { id: "eyes", emoji: "👀", label: "Spectator", desc: "Watching closely!", category: "emoji" },
  { id: "laugh", emoji: "😂", label: "Classic Laugh", desc: "Good humor!", category: "emoji" },
];

export const REACTION_EMOJIS = ["❤️", "👍", "🔥", "👑", "😂", "😮", "😢", "👏", "⚔️"];

export const QUICK_GAME_MESSAGES = [
  "Good luck! ⚔️",
  "Well played! 👏",
  "Nice tactic! 🧠",
  "Great game! 🤝",
  "Take your time! ⏳",
  "Watch out for the King! 👑",
  "Rematch soon? 🔄",
  "Gbemidebe! 🔥"
];

export function getRankBadge(eloRating: number) {
  if (eloRating < 1400) return { title: "Amateur Contender", style: "bg-slate-700/25 border-slate-700/40 text-slate-400" };
  if (eloRating < 1600) return { title: "Candidate Expert", style: "bg-orange-950/25 border-orange-900/35 text-orange-400" };
  if (eloRating < 1800) return { title: "National Master", style: "bg-sky-950/25 border-sky-900/35 text-sky-400" };
  if (eloRating < 2000) return { title: "International Master", style: "bg-violet-950/25 border-violet-900/35 text-violet-400" };
  return { title: "🏆 GRANDMASTER", style: "bg-amber-500/10 border-amber-500/30 text-amber-400" };
}

export function playLoungeSound(type: "send" | "receive" | "record_start" | "record_stop" | "sticker" | "friend_accept" | "seen") {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (type === "send") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(580, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.16);
    } else if (type === "receive") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.09, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.22);
    } else if (type === "sticker") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.05);
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.22);
    } else if (type === "record_start") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(261.63, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(392, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } else if (type === "record_stop") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(392, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(261.63, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } else if (type === "seen") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.13);
    } else if (type === "friend_accept") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.06);
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.32);
    }
  } catch (e) {
    // Ignore audio context errors
  }
}

export function formatMessageTime(timestamp: string | number): string {
  try {
    const date = typeof timestamp === "number" ? new Date(timestamp) : new Date(timestamp);
    if (isNaN(date.getTime())) return "";

    const now = new Date();
    const isToday = now.toDateString() === date.toDateString();
    
    // Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = yesterday.toDateString() === date.toDateString();

    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    const formattedHours = hours % 12 || 12;
    const formattedMinutes = minutes < 10 ? `0${minutes}` : minutes;
    const timeStr = `${formattedHours}:${formattedMinutes} ${ampm}`;

    if (isToday) return timeStr;
    if (isYesterday) return `Yesterday, ${timeStr}`;
    return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${timeStr}`;
  } catch {
    return "";
  }
}
