/**
 * Re-exported Hydra WebSocket message types.
 *
 * `ServerOutput` is a discriminated union (on `.tag`) of all possible messages
 * the Hydra node can send over its WebSocket API. Use `Extract` to narrow:
 *
 * @example
 * ```ts
 * function handleOpen(msg: HydraMessage<"HeadIsOpen">) {
 *   console.log(msg.tag);
 * }
 * ```
 */
export type {
  ClientInput,
  ClientMessage,
  ConnectionState,
  HeadStatus,
  HydraMessage,
  HydraStatus,
  HydraTransaction,
  HydraWsMessage,
  hydraStatus,
  hydraTransaction,
  ServerOutput,
} from './types.js';
