import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });

process.stderr.write('fake stderr\n');
process.stdout.write('not json\n');
process.stdout.write(
  `${JSON.stringify({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { update: { sessionUpdate: 'usage_update' } },
  })}\n`,
);

rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'fail') {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -1, message: 'failed as requested' },
      })}\n`,
    );
    return;
  }
  const result =
    message.method === 'session/new'
      ? { sessionId: 'fake-session' }
      : message.method === 'session/prompt'
        ? { stopReason: 'end_turn' }
        : { method: message.method, params: message.params };
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result,
    })}\n`,
  );
});
