export type MorphHistoryShortcut = 'undo' | 'redo';

type KeyboardShortcutInput = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

export function getMorphHistoryShortcut(
  event: KeyboardShortcutInput,
  editableTarget: boolean,
): MorphHistoryShortcut | null {
  if (editableTarget || event.altKey || (!event.ctrlKey && !event.metaKey)) return null;

  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey) return 'redo';
  return null;
}
