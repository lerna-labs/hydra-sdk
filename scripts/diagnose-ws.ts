#!/usr/bin/env npx tsx
/**
 * Diagnostic script for Hydra WebSocket connectivity.
 *
 * Run from the project root:
 *   npx tsx scripts/diagnose-ws.ts ws://hydra-node-preprod-alpha:4102
 *
 * Or from inside a Docker container on the same network:
 *   npx tsx scripts/diagnose-ws.ts ws://hydra-node-preprod-alpha:4102
 *
 * This script bypasses all SDK abstractions and connects directly
 * with the `ws` package, logging every event with timestamps.
 */

import WebSocket from 'ws';

const url = process.argv[2];
if (!url) {
  console.error('Usage: npx tsx scripts/diagnose-ws.ts <ws-url>');
  console.error('  e.g. npx tsx scripts/diagnose-ws.ts ws://localhost:4102');
  process.exit(1);
}

const ts = () => new Date().toISOString();

console.log(`[${ts()}] Connecting to: ${url}`);
console.log(`[${ts()}] ws version: (see package.json)`);
console.log(`[${ts()}] Node version: ${process.version}`);
console.log('---');

const ws = new WebSocket(url);

ws.on('open', () => {
  console.log(`[${ts()}] EVENT: open`);
  console.log(`[${ts()}]   readyState: ${ws.readyState} (${ws.readyState === WebSocket.OPEN ? 'OPEN' : 'other'})`);
  console.log(`[${ts()}]   protocol: ${ws.protocol || '(none)'}`);
  console.log(`[${ts()}]   extensions: ${ws.extensions || '(none)'}`);
});

ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
  console.log(`[${ts()}] EVENT: message`);
  console.log(`[${ts()}]   isBinary: ${isBinary}`);
  console.log(`[${ts()}]   type: ${typeof data} / ${data.constructor.name}`);
  console.log(`[${ts()}]   byteLength: ${Buffer.isBuffer(data) ? data.byteLength : 'N/A'}`);

  const raw = data.toString();
  console.log(`[${ts()}]   raw (first 500 chars): ${raw.slice(0, 500)}`);

  try {
    const parsed = JSON.parse(raw);
    console.log(`[${ts()}]   parsed.tag: ${parsed.tag}`);
    if (parsed.tag === 'Greetings') {
      console.log(`[${ts()}]   headStatus: ${parsed.headStatus}`);
      console.log(`[${ts()}]   hydraNodeVersion: ${parsed.hydraNodeVersion}`);
      console.log(`[${ts()}]   keys: ${Object.keys(parsed).join(', ')}`);
    }
    console.log(`[${ts()}]   full JSON: ${JSON.stringify(parsed, null, 2).slice(0, 2000)}`);
  } catch (err) {
    console.log(`[${ts()}]   JSON parse FAILED: ${err}`);
  }
});

ws.on('ping', (data) => {
  console.log(`[${ts()}] EVENT: ping (${data.toString()})`);
});

ws.on('pong', (data) => {
  console.log(`[${ts()}] EVENT: pong (${data.toString()})`);
});

ws.on('upgrade', (response) => {
  console.log(`[${ts()}] EVENT: upgrade`);
  console.log(`[${ts()}]   statusCode: ${response.statusCode}`);
  console.log(`[${ts()}]   headers: ${JSON.stringify(Object.fromEntries(Object.entries(response.headers)))}`);
});

ws.on('unexpected-response', (req, response) => {
  console.log(`[${ts()}] EVENT: unexpected-response`);
  console.log(`[${ts()}]   statusCode: ${response.statusCode}`);
  console.log(`[${ts()}]   headers: ${JSON.stringify(response.headers)}`);
  let body = '';
  response.on('data', (chunk: Buffer) => (body += chunk.toString()));
  response.on('end', () => console.log(`[${ts()}]   body: ${body.slice(0, 1000)}`));
});

ws.on('error', (err) => {
  console.log(`[${ts()}] EVENT: error`);
  console.log(`[${ts()}]   message: ${err.message}`);
  console.log(`[${ts()}]   code: ${(err as any).code}`);
});

ws.on('close', (code, reason) => {
  console.log(`[${ts()}] EVENT: close`);
  console.log(`[${ts()}]   code: ${code}`);
  console.log(`[${ts()}]   reason: ${reason.toString()}`);
});

// Also test the SDK's HydraWebSocket class
setTimeout(async () => {
  console.log('\n--- SDK HydraWebSocket test ---\n');

  try {
    const { HydraWebSocket } = await import('../packages/core/src/hydra/hydra-websocket.js');
    const hydraWs = new HydraWebSocket(url);

    hydraWs.on('message', (msg: any) => {
      console.log(`[${ts()}] SDK message: tag=${msg.tag}, headStatus=${msg.headStatus}`);
    });

    hydraWs.on('error', (err: Error) => {
      console.log(`[${ts()}] SDK error: ${err.message}`);
    });

    console.log(`[${ts()}] SDK: calling waitForGreetings(10000)...`);
    const result = await hydraWs.waitForGreetings(10000);
    console.log(`[${ts()}] SDK: waitForGreetings returned: ${result}`);
    console.log(`[${ts()}] SDK: connectionState: ${hydraWs.connectionState}`);
    console.log(`[${ts()}] SDK: status: ${hydraWs.getStatus()}`);

    await hydraWs.disconnect();
    console.log(`[${ts()}] SDK: disconnected`);
  } catch (err) {
    console.log(`[${ts()}] SDK FAILED: ${err}`);
  }

  process.exit(0);
}, 5000);

// Safety timeout
setTimeout(() => {
  console.log(`\n[${ts()}] 30s timeout reached, exiting.`);
  process.exit(1);
}, 30000);
