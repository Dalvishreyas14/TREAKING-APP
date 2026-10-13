import {
  BookOpen,
  Brain,
  Calendar,
  CalendarRange,
  CheckSquare,
  Dumbbell,
  Flag,
  FolderKanban,
  GraduationCap,
  Home,
  BellRing,
  Library,
  LineChart,
  ListTodo,
  Moon,
  Settings,
  Sparkles,
  Target,
  Timer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The application's navigation, defined once.
 *
 * The sidebar, the mobile bar and the command palette all render from this list,
 * which is the only way they can be guaranteed to agree. Adding a screen means
 * adding an entry here, not three.
 *
 * `keywords` exist for the palette's fuzzy match. They are the words a person
 * would actually type, which are often not the words on screen: someone looking
 * for the habit grid types "streak", not "habits".
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  keywords: string[];
  /** Exact-match routes that should also highlight this item. */
  matchPrefixes?: string[];
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    id: "today",
    label: "Today",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: Home,
        keywords: ["home", "overview", "today", "start"],
        // A task opened from the dashboard is still "on the dashboard".
        matchPrefixes: ["/dashboard"],
      },
      {
        href: "/planner",
        label: "Planner",
        icon: Calendar,
        keywords: ["day", "schedule", "timeline", "calendar", "schedule my day"],
      },
      {
        href: "/tasks",
        label: "Tasks",
        icon: CheckSquare,
        keywords: ["todo", "to do", "action", "backlog", "inbox"],
      },
      {
        href: "/focus",
        label: "Focus",
        icon: Timer,
        keywords: ["timer", "pomodoro", "deep work", "session", "distraction"],
      },
    ],
  },
  {
    id: "track",
    label: "Track",
    items: [
      {
        href: "/habits",
        label: "Habits",
        icon: Target,
        keywords: ["streak", "daily", "routine check", "consistency", "grid"],
      },
      {
        href: "/wellbeing",
        label: "Wellbeing",
        icon: Moon,
        keywords: ["mood", "energy", "sleep", "stress", "how am i", "journal mood"],
      },
      {
        href: "/journal",
        label: "Journal",
        icon: BookOpen,
        keywords: ["write", "notes", "diary", "reflection", "entry"],
      },
      {
        href: "/fitness",
        label: "Fitness",
        icon: Dumbbell,
        keywords: ["workout", "gym", "run", "steps", "exercise", "strength"],
      },
      {
        href: "/study",
        label: "Study",
        icon: GraduationCap,
        keywords: ["books", "reading", "course", "learning", "revision"],
      },
      {
        href: "/knowledge",
        label: "Knowledge",
        icon: Library,
        keywords: [
          "notes",
          "library",
          "reading list",
          "bookshelf",
          "highlights",
          "resources",
          "saved",
        ],
      },
    ],
  },
  {
    id: "direction",
    label: "Direction",
    items: [
      {
        href: "/goals",
        label: "Goals",
        icon: Flag,
        keywords: ["aim", "target", "milestone", "ambition", "objective"],
      },
      {
        href: "/projects",
        label: "Projects",
        icon: FolderKanban,
        keywords: ["work", "deliverable", "sprint", "roadmap"],
      },
      {
        href: "/analytics",
        label: "Analytics",
        icon: LineChart,
        keywords: ["stats", "report", "chart", "graph", "progress", "review", "trends"],
      },
      {
        href: "/insights",
        label: "Insights",
        icon: Sparkles,
        keywords: ["patterns", "advice", "coaching", "correlations", "what the data says"],
      },
    ],
  },
  {
    id: "assist",
    label: "Assist",
    items: [
      {
        href: "/ai",
        label: "AI Assistant",
        icon: Brain,
        keywords: ["chat", "ask", "assistant", "coach", "help", "llm"],
      },
      {
        href: "/routines",
        label: "Routines",
        icon: ListTodo,
        keywords: ["morning", "evening", "template", "sequence", "wind down"],
      },
      {
        href: "/notifications",
        label: "Reminders",
        icon: BellRing,
        keywords: ["reminder", "alarm", "notification", "notify", "ping", "inbox"],
      },
      {
        href: "/calendar",
        label: "Calendar",
        icon: CalendarRange,
        keywords: ["events", "meetings", "appointments", "month", "week"],
      },
    ],
  },
];

export const SETTINGS_NAV: NavItem = {
  href: "/settings",
  label: "Settings",
  icon: Settings,
  keywords: ["preferences", "profile", "account", "theme", "password", "export", "delete"],
};

export const ALL_NAV_ITEMS: NavItem[] = [
  ...NAV.flatMap((group) => group.items),
  SETTINGS_NAV,
];

/** True when `pathname` should light up `item`. */
export function isActiveItem(item: NavItem, pathname: string): boolean {
  if (pathname === item.href) return true;
  return (item.matchPrefixes ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** The primary destinations, used for the mobile bottom bar where space is tight. */
export const MOBILE_PRIMARY: NavItem[] = [
  NAV[0]!.items[0]!,
  NAV[0]!.items[1]!,
  NAV[0]!.items[2]!,
  NAV[3]!.items[0]!,
];
