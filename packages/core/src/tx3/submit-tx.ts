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
