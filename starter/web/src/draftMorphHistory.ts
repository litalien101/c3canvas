export type MorphDraftHistory<T extends object> = {
  past: T[];
  future: T[];
};

const MAX_MORPH_HISTORY = 50;

export function createMorphDraftHistory<T extends object>(): MorphDraftHistory<T> {
  return { past: [], future: [] };
}

export function pushMorphDraftHistory<T extends object>(
  history: MorphDraftHistory<T>,
  current: T,
): MorphDraftHistory<T> {
  return {
    past: [...history.past, { ...current }].slice(-MAX_MORPH_HISTORY),
    future: [],
  };
}

export function undoMorphDraftHistory<T extends object>(
  history: MorphDraftHistory<T>,
  current: T,
): { history: MorphDraftHistory<T>; values: T } | null {
  const values = history.past.at(-1);
  if (!values) return null;
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, { ...current }].slice(-MAX_MORPH_HISTORY),
    },
    values: { ...values },
  };
}

export function redoMorphDraftHistory<T extends object>(
  history: MorphDraftHistory<T>,
  current: T,
): { history: MorphDraftHistory<T>; values: T } | null {
  const values = history.future.at(-1);
  if (!values) return null;
  return {
    history: {
      past: [...history.past, { ...current }].slice(-MAX_MORPH_HISTORY),
      future: history.future.slice(0, -1),
    },
    values: { ...values },
  };
}
