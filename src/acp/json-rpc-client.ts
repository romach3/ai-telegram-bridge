import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';
import type { AcpJsonRpcMessage, AcpRequestId, JsonValue } from '../types';

interface PendingRequest {
  resolve(value: JsonValue | undefined): void;
  reject(error: Error): void;
}

export class AcpClient extends EventEmitter {
  private process?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(
    private readonly command: string,
    private readonly cwd: string,
    private readonly args: string[] = [],
  ) {
    super();
  }

  start(): void {
    if (this.process) return;
    this.process = spawn(this.command, this.args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      detached: process.platform !== 'win32',
    });

    const stdout = readline.createInterface({ input: this.process.stdout });
    stdout.on('line', (line) => this.handleLine(line));
    this.process.stderr.on('data', (data) =>
      this.emit('stderr', data.toString()),
    );
    this.process.on('exit', (code, signal) => {
      this.emit('exit', { code, signal });
      for (const pending of this.pending.values()) {
        pending.reject(
          new Error(`ACP process exited: ${code ?? signal ?? 'unknown'}`),
        );
      }
      this.pending.clear();
    });
  }

  stop(): void {
    const child = this.process;
    if (!child) return;
    this.process = undefined;
    child.stdin.end();
    const pid = child.pid;
    if (!pid) {
      child.kill('SIGTERM');
      return;
    }
    if (process.platform === 'win32') {
      child.kill('SIGTERM');
      return;
    }
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Process group already exited.
      }
    }, 1000).unref();
  }

  async request<T>(method: string, params?: JsonValue): Promise<T> {
    this.start();
    const id = this.nextId++;
    const message: AcpJsonRpcMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };
    const response = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: JsonValue | undefined) => void,
        reject,
      });
    });
    this.write(message);
    return response;
  }

  notify(method: string, params?: JsonValue): void {
    this.start();
    this.write({ jsonrpc: '2.0', method, params });
  }

  respond(id: AcpRequestId, result: JsonValue): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  private write(message: AcpJsonRpcMessage): void {
    if (!this.process) throw new Error('ACP process is not started');
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: AcpJsonRpcMessage;
    try {
      message = JSON.parse(line) as AcpJsonRpcMessage;
    } catch {
      this.emit('raw', line);
      return;
    }

    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(Number(message.id));
      if (pending) {
        this.pending.delete(Number(message.id));
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      this.emit('message', message);
      return;
    }

    this.emit('message', message);
  }
}
