# Custom Backends

This directory is the extension point for project-local backend implementations.

Use it when a backend is not the built-in stdio ACP adapter in `../acp/`.

Minimal contract:

```ts
import { AcpBackend } from '../../types';

export class ExampleBackend implements AcpBackend {
  // Implement initialize, createSession, loadSession, prompt, cancel, stop,
  // and EventEmitter-compatible message/stderr/exit events.
}
```

Register the backend in `../registry.ts` so config can select it by `type`.

Keep provider-specific behavior here. Change `../acp/`, `../../telegram/`, or
`../../runtime.ts` only when the shared bridge behavior itself changes.
