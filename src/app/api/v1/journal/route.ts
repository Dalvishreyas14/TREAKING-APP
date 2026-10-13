import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/v1/journal?from&to&limit    POST /api/v1/journal
 *
 * `JournalEntry` carries `@@unique([userId, date])`, so a day holds exactly one
 * entry and POST is an upsert rather than an append. That is a real product
 * decision the schema already made: the journal is a daily reflection, not a
 * stream, and today's page always has one place to write.
 *
 * `wordCount` is derived on write. It exists so the journal list can show
 * "1,240 words" without reading every entry's full text, and a stored count that
 * disagrees with the text is worse than no count at all.
 *
 * `date` arrives as a `yyyy-MM-dd` string. `z.coerce.date()` turns that into UTC
 * midnight, which is precisely what the `@db.Date` column wants, so no local
 * time zone is involved and nothing can be shifted a day.
 */

const listQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(120).default(30),
});

const upsertBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  title: z.string().trim().max(200).nullable().optional(),
  content: z.string().trim().min(1, "Write something first").max(50000),
  mood: z.coerce.number().int().min(1).max(5).nullable().optional(),
  energy: z.coerce.number().int().min(1).max(5).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
});

/** Trimmed words, counted on whitespace. Good enough for a "how much did I write" hint. */
function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

const entrySelect = {
  id: true,
  date: true,
  title: true,
  content: true,
  mood: true,
  energy: true,
  tags: true,
  aiSummary: true,
  wordCount: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const GET = withApi({
  method: "GET",
  query: listQuery,
  async handler({ user, query }) {
    const entries = await prisma.journalEntry.findMany({
      where: {
        userId: user.id,
        ...(query.from ? { date: { gte: new Date(`${query.from}T00:00:00.000Z`) } } : {}),
        ...(query.to ? { date: { lte: new Date(`${query.to}T00:00:00.000Z`) } } : {}),
        ...(query.q ? { content: { contains: query.q, mode: "insensitive" } } : {}),
      },
      orderBy: { date: "desc" },
      take: query.limit,
      select: entrySelect,
    });

    const totals = await prisma.journalEntry.aggregate({
      where: { userId: user.id },
      _sum: { wordCount: true },
      _count: { _all: true },
    });

    return {
      items: entries,
      totals: { entries: totals._count._all, words: totals._sum.wordCount ?? 0 },
    };
  },
});

export const POST = withApi({
  method: "POST",
  body: upsertBody,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    const date = new Date(`${body.date}T00:00:00.000Z`);

    const entry = await prisma.journalEntry.upsert({
      where: { userId_date: { userId: user.id, date } },
      create: {
        userId: user.id,
        date,
        title: body.title ?? null,
        content: body.content,
        mood: body.mood ?? null,
        energy: body.energy ?? null,
        tags: body.tags,
        wordCount: countWords(body.content),
      },
      update: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        content: body.content,
        ...(body.mood !== undefined ? { mood: body.mood } : {}),
        ...(body.energy !== undefined ? { energy: body.energy } : {}),
        tags: body.tags,
        wordCount: countWords(body.content),
      },
      select: entrySelect,
    });

    return entry;
  },
});
