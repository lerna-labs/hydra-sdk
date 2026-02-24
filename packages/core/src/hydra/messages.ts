/**
 * Re-exported Hydra WebSocket message types from `@meshsdk/hydra`.
 *
 * `ServerOutput` is a discriminated union (on `.tag`) of all possible messages
 * the Hydra node can send over its WebSocket API. Use `Extract` to narrow:
 *
 * @example
 * ```ts
 * function handleOpen(msg: HydraMessage<"HeadIsOpen">) {
 *   console.log(msg.headId, msg.utxo);
 * }
 * ```
 */
export type { ClientInput, ClientMessage, ConnectionState, ServerOutput } from '@meshsdk/hydra';

// Re-import for use in utility types below
import type { ClientMessage, ServerOutput } from '@meshsdk/hydra';

/** Any message received via the Hydra WebSocket (server output or client echo). */
export type HydraWsMessage = ServerOutput | ClientMessage;

/**
 * Extract a specific message type from the `ServerOutput` union by its `tag`.
 *
 * @example
 * ```ts
 * type Greetings = HydraMessage<"Greetings">;
 * // { tag: "Greetings"; me: { vkey: string }; headStatus: HeadStatus; ... }
 * ```
 */
export type HydraMessage<T extends ServerOutput['tag']> = Extract<ServerOutput, { tag: T }>;

/** Possible Hydra head states as reported in the `Greetings` message. */
export type HeadStatus = 'Idle' | 'Initializing' | 'Open' | 'Closed' | 'FanoutPossible' | 'Final';
