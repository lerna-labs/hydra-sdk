/**
 * Submit a transaction to a TRP endpoint via JSON-RPC.
 *
 * @param submit_endpoint - URL of the TRP submit endpoint.
 * @param payload - Hex-encoded transaction payload.
 * @param id - JSON-RPC request identifier.
 * @returns The fetch Response from the TRP endpoint.
 */
export async function submitTx(submit_endpoint: string, payload: string, id: string): Promise<Response> {
  return await fetch(submit_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'trp.submit',
      params: {
        tx: {
          payload,
          encoding: 'hex',
          version: 'v1alpha6',
        },
      },
      id,
    }),
  });
}
