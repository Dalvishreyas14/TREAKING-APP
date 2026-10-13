import { BookOpen } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JournalEditor, type JournalRow } from "@/components/app/journal-editor";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { addDaysUtc, todayUtc } from "@/lib/date";
import { formatIndianMedium } from "@/lib/format/date";

export const dynamic = "force-dynamic";

/**
 * Journal.
 *
 * A month of entries, plus the composer for today's. Entries are addressed by
 * `date` rather than by id in the UI, because the thing a person is writing is
 * "today's entry" — opening, editing or re-opening it should all be the same
 * address, and an id-keyed list would let two entries exist for one day and make
 * the question "what did I write on the 4th" ambiguous.
 *
 * `wordCount` is stored rather than computed on read. It is shown on every entry
 * in the list, so counting every body on every render would be O(n) work over
 * text that never changes once written.
 */

const WINDOW_DAYS = 30;
const LIST_LIMIT = 60;

export default async function JournalPage() {
  const user = await requireUser();
  const today = todayUtc();
  const from = addDaysUtc(today, -(WINDOW_DAYS - 1));

  const entries = await prisma.journalEntry.findMany({
    where: { userId: user.id, date: { gte: from, lte: today } },
    orderBy: { date: "desc" },
    take: LIST_LIMIT,
    select: {
      id: true,
      date: true,
      title: true,
      content: true,
      mood: true,
      energy: true,
      tags: true,
      wordCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const rows: JournalRow[] = entries.map((e) => ({
    id: e.id,
    date: e.date.toISOString().slice(0, 10),
    title: e.title,
    content: e.content,
    mood: e.mood,
    energy: e.energy,
    tags: e.tags,
    wordCount: e.wordCount,
  }));

  const todayKey = today.toISOString().slice(0, 10);
  const todayEntry = rows.find((r) => r.date === todayKey) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Journal</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          One entry a day. Nobody else can read it.
        </p>
      </header>

      <JournalEditor todayEntry={todayEntry} />

      <Card>
        <CardHeader>
          <CardTitle>Recent entries</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              size="sm"
              title="Nothing written yet"
              description="Your entries will collect here, newest first."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {rows.map((row) => (
                <li key={row.id}>
                  <details className="group py-3">
                    <summary className="flex cursor-pointer list-none items-center gap-3">
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-ink">
                          {row.title || firstLine(row.content)}
                        </span>
                        <span className="text-xs text-ink-subtle">
                          {formatDate(row.date)} · {row.wordCount}{" "}
                          {row.wordCount === 1 ? "word" : "words"}
                        </span>
                      </div>
                      {row.tags.slice(0, 2).map((tag) => (
                        <Badge key={tag} variant="neutral" size="sm">
                          {tag}
                        </Badge>
                      ))}
                      {row.mood ? (
                        <Badge variant="iris" size="sm">
                          mood {row.mood}/5
                        </Badge>
                      ) : null}
                    </summary>
                    <p className="mt-2.5 text-sm leading-relaxed whitespace-pre-wrap text-ink-muted">
                      {row.content}
                    </p>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function firstLine(content: string): string {
  const line = content.split("\n").find((l) => l.trim().length > 0) ?? content;
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}

function formatDate(isoDay: string): string {
  // `isoDay` is a `@db.Date`, so read the UTC calendar day. A bare `YYYY-MM-DD`
  // parsed by `new Date` is UTC midnight, which the local formatters would show
  // as the previous day for anyone west of Greenwich.
  return formatIndianMedium(new Date(`${isoDay}T00:00:00Z`));
}
