export type OfflineItemState = "ready" | "fix" | "checking" | "cannot-check";
export type OfflineSummaryState = "ready" | "fix" | "checking" | "cannot-check" | "empty";

export interface HomeworkOfflineItem {
  id: string;
  state: OfflineItemState;
  text: string;
}

export interface HomeworkOfflineSummary {
  state: OfflineSummaryState;
  text: string;
}

export interface HomeworkOfflineResult {
  items: HomeworkOfflineItem[];
  summary: HomeworkOfflineSummary;
}

export interface HomeworkOfflineInput {
  activities: { id: string; kind: string; title: string }[];
  sourceState: (id: string) => "changed" | "missing" | "unavailable" | undefined;
  sourceMissing: (id: string) => boolean;
  checked: boolean;
  canCheckFiles: boolean;
}

const ITEM_TEXT: Record<OfflineItemState, string> = {
  ready: "Works offline",
  fix: "Needs a fix",
  checking: "Checking…",
  "cannot-check": "Check in the Mac app",
};

export function homeworkOfflineSummary(input: HomeworkOfflineInput): HomeworkOfflineResult {
  const { activities, sourceState, sourceMissing, checked, canCheckFiles } = input;

  if (activities.length === 0) {
    return {
      items: [],
      summary: {
        state: "empty",
        text: "",
      },
    };
  }

  const items: HomeworkOfflineItem[] = activities.map((activity) => {
    const { id, kind } = activity;

    if (["reflection", "questions", "checklist"].includes(kind)) {
      return {
        id,
        state: "ready",
        text: ITEM_TEXT.ready,
      };
    }

    if (["read", "cards", "test"].includes(kind)) {
      const isFix = sourceMissing(id) || sourceState(id) !== undefined;
      if (isFix) {
        return {
          id,
          state: "fix",
          text: ITEM_TEXT.fix,
        };
      }

      if (!checked) {
        return {
          id,
          state: "checking",
          text: ITEM_TEXT.checking,
        };
      }

      if (kind === "read" && !canCheckFiles) {
        return {
          id,
          state: "cannot-check",
          text: ITEM_TEXT["cannot-check"],
        };
      }

      return {
        id,
        state: "ready",
        text: ITEM_TEXT.ready,
      };
    }

    return {
      id,
      state: "ready",
      text: ITEM_TEXT.ready,
    };
  });

  const fixCount = items.filter((item) => item.state === "fix").length;
  const m = items.length;

  let summaryState: OfflineSummaryState;
  let summaryText: string;

  if (fixCount > 0) {
    summaryState = "fix";
    summaryText =
      fixCount === 1
        ? `1 of ${m} needs a fix before you study offline.`
        : `${fixCount} of ${m} need a fix before you study offline.`;
  } else if (items.some((item) => item.state === "checking")) {
    summaryState = "checking";
    summaryText = "Checking what works without internet…";
  } else if (items.some((item) => item.state === "cannot-check")) {
    summaryState = "cannot-check";
    summaryText = "PDF readings can only be checked in the Mac app.";
  } else {
    summaryState = "ready";
    summaryText = "Everything here works without internet.";
  }

  return {
    items,
    summary: {
      state: summaryState,
      text: summaryText,
    },
  };
}
