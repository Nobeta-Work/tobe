import { decodeWireFrame, encodeWireFrame } from "../protocol.ts";

export type FrameListener = (frame: string) => void | Promise<void>;

/** 仅负责可靠字节传输，不包含登录、业务事件或 trust 逻辑。 */
export class IIroseClient {
  #socket: WebSocket | null = null;
  #sendLock: Promise<void> = Promise.resolve();
  readonly #listeners = new Set<FrameListener>();

  get connected(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  async connect(url: string, timeoutMs: number): Promise<void> {
    if (this.connected) return;
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      void decodeWireFrame(event.data).then((frame) => {
        for (const listener of this.#listeners) void listener(frame);
      });
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`WebSocket connect timed out after ${timeoutMs}ms`)), timeoutMs);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("WebSocket connection failed")); }, { once: true });
    });
  }

  subscribe(listener: FrameListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  waitForFrame(predicate: (frame: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const unsubscribe = this.subscribe((frame) => {
        if (!predicate(frame)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(frame);
      });
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`IIROSE response timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  async send(frame: string): Promise<void> {
    this.#sendLock = this.#sendLock.then(() => {
      if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
        throw new Error("IIROSE WebSocket is not connected");
      }
      this.#socket.send(encodeWireFrame(frame));
    });
    return this.#sendLock;
  }

  close(code = 1000, reason = "adapter stopped"): void {
    const socket = this.#socket;
    this.#socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(code, reason);
  }

  onClose(listener: () => void): () => void {
    const socket = this.#socket;
    if (!socket) return () => undefined;
    socket.addEventListener("close", listener);
    return () => socket.removeEventListener("close", listener);
  }
}
