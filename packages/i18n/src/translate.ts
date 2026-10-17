import { fa, type Messages } from './messages/fa.js';

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every valid translation key, e.g. `health.title`. */
export type MessageKey = Leaves<Messages>;

export type MessageParams = Record<string, string | number>;

function lookup(key: MessageKey): string {
  let node: unknown = fa;
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== 'string') {
    throw new Error(`Missing translation for key "${key}"`);
  }
  return node;
}

/** Returns the Persian string for `key`, replacing `{name}` placeholders from `params`. */
export function t(key: MessageKey, params?: MessageParams): string {
  const template = lookup(key);
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
