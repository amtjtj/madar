/**
 * A reply drafted on the letter page travels to the composer through this tab's session storage
 * (never the URL: letter text stays out of history and logs). Read once, then cleared.
 */
const KEY = (letterId: string) => `madar.replyDraft.${letterId}`;

export function keepReplyDraft(letterId: string, text: string): void {
  try {
    sessionStorage.setItem(KEY(letterId), text);
  } catch {
    // Storage blocked: the composer simply opens empty.
  }
}

export function peekReplyDraft(letterId: string): string | null {
  try {
    return sessionStorage.getItem(KEY(letterId));
  } catch {
    return null;
  }
}

export function dropReplyDraft(letterId: string): void {
  try {
    sessionStorage.removeItem(KEY(letterId));
  } catch {
    // Nothing to clear.
  }
}
