// Typed messages between UI <-> background <-> content (SPEC.md section 10).
import { browser } from 'wxt/browser';
import type { Company, RunState } from './types';
import { NOT_IN_EXTENSION_MSG } from './storage';

type NoPayload = Record<never, never>;

export interface MessageMap {
  startRun: { req: NoPayload; res: RunState };
  getRunState: { req: NoPayload; res: RunState | null };
  testCompany: { req: { company: Company }; res: { count: number } };
}

export type MessageType = keyof MessageMap;

export type Message = { [K in MessageType]: { type: K } & MessageMap[K]['req'] }[MessageType];

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export function isMessage(m: unknown): m is Message {
  return typeof m === 'object' && m !== null && typeof (m as { type?: unknown }).type === 'string';
}

/** UI side: send a typed message to the background and unwrap the Result (throws on error). */
export async function send<K extends MessageType>(
  type: K,
  ...payload: [keyof MessageMap[K]['req']] extends [never] ? [] : [MessageMap[K]['req']]
): Promise<MessageMap[K]['res']> {
  if (!browser?.runtime?.sendMessage) throw new Error(NOT_IN_EXTENSION_MSG);
  const res = (await browser.runtime.sendMessage({ type, ...(payload[0] ?? {}) })) as
    | Result<MessageMap[K]['res']>
    | undefined;
  if (!res) throw new Error('אין תשובה מרקע התוסף — נסי לסגור ולפתוח את החלונית');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export type Handlers = { [K in MessageType]: (req: MessageMap[K]['req']) => Promise<MessageMap[K]['res']> };

/** Background side: dispatch a message to its handler and wrap the outcome in a Result. */
export async function dispatch(handlers: Handlers, msg: Message): Promise<Result<unknown>> {
  const handler = handlers[msg.type] as ((req: unknown) => Promise<unknown>) | undefined;
  if (!handler) return { ok: false, error: `Unknown message: ${msg.type}` };
  try {
    return { ok: true, data: await handler(msg) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
