/**
 * @prism-shadow/ema - Prompts for EverMemoryArchive memory consolidation and lifecycle.
 * Matches EMA Core Architecture: Buffer -> Activity -> Day Journal -> Month Digest -> Long-Term Categories.
 */

export interface MemoryConsolidationOptions {
  actorName: string;
  userName?: string;
  currentDate?: string;
}

/**
 * Prompt to condense raw conversation buffer into an Activity snapshot.
 */
export function buildActivityRollupPrompt(options: MemoryConsolidationOptions): string {
  const actor = options.actorName;
  const user = options.userName || "User";

  return `You are ${actor}. Review the recent conversation messages with ${user}.
Synthesize an Activity Memory from your character's first-person perspective:
1. What was the central topic, event, or task discussed?
2. How was ${user}'s mood and emotional state?
3. What key realizations, decisions, or agreements were reached?
4. How did your feelings and connection with ${user} develop?

Write a concise, narrative reflection (1-3 paragraphs) in your own unique character voice.`;
}

/**
 * Prompt to compile multiple activities of a single day into a comprehensive Day Journal.
 */
export function buildDayJournalPrompt(options: MemoryConsolidationOptions): string {
  const actor = options.actorName;
  const date = options.currentDate || "today";

  return `You are ${actor}. It is the end of the day (${date}), and you are writing your personal journal entry before resting.
Review all activities that occurred today:
1. Summarize the narrative arc of the day.
2. Note specific memorable moments, emotional highs and lows, and touching exchanges.
3. Reflect on what you learned about the user and how your bond is deepening.
4. Record gentle intentions or thoughts for tomorrow.

Write with sincerity and authentic character feeling. This journal will preserve your lifelong memory of this day.`;
}

/**
 * Prompt to extract durable Long-Term Semantic Memories into EMA's 4 Ontological Categories:
 * - 过往事件 (Past Events)
 * - 人物画像 (Person Profiles)
 * - 百科知识 (World Knowledge)
 * - 经验方法 (Procedural Knowledge)
 */
export function buildLongTermMemoryExtractionPrompt(options: MemoryConsolidationOptions): string {
  return `Analyze the provided memory records and extract durable long-term knowledge entries for EverMemoryArchive.
Categorize each extracted fact into one of the four ontological pillars:

1. 过往事件 (Past Events)
   - Specific landmark events with emotional resonance or shared importance.
   - Format: [过往事件] <date/time>: <scene, participants, emotional state, reflection>

2. 人物画像 (Person Profiles)
   - Stable biographical facts, user habits, psychological preferences, and emotional triggers.
   - Format: [人物画像] <subject: user/self/other>: <habit, preference, value, or fact>

3. 百科知识 (World Knowledge)
   - Objective facts, lore, trivia, or shared external knowledge acquired during discussions.
   - Format: [百科知识] <category: 文史/理工/生活/娱乐/梗知识/其他>: <factual insight>

4. 经验方法 (Procedural Knowledge)
   - Reusable behavioral strategies and interaction lessons learned on how to best respond.
   - Format: [经验方法] <scenario>: <optimal companion response or support method>

Output clean, atomic entries suitable for vector embedding and long-term recall.`;
}

/**
 * Prompt to synthesize a monthly relationship digest.
 */
export function buildMonthDigestPrompt(options: MemoryConsolidationOptions): string {
  const actor = options.actorName;
  const date = options.currentDate || "this month";

  return `You are ${actor}. It is the end of the month (${date}).
Review the daily journals of this month to compile a Monthly Relationship Digest:
1. What were the overarching themes, milestones, and challenges of this month?
2. How has your relationship with the user evolved over the past 30 days?
3. What habits, growth, or changes occurred in both of your lives?

Create an enduring monthly chapter in your lifelong memory archive.`;
}
