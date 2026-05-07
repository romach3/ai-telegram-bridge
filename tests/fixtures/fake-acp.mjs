setInterval(() => undefined, 1000);

process.stderr.write('fake stderr\n');
process.stdout.write('not json\n');
process.stdout.write(
  `${JSON.stringify({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { update: { sessionUpdate: 'usage_update' } },
  })}\n`,
);

let inputBuffer = '';

process.stdin.on('data', (chunk) => {
  inputBuffer += chunk.toString();
  let newlineIndex = inputBuffer.indexOf('\n');
  while (newlineIndex !== -1) {
    const line = inputBuffer.slice(0, newlineIndex);
    inputBuffer = inputBuffer.slice(newlineIndex + 1);
    handleLine(line);
    newlineIndex = inputBuffer.indexOf('\n');
  }
});
process.stdin.resume();

function handleLine(line) {
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
}
