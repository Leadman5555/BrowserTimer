export const MessageBuilder = {
  tabFocused: (data: TabActionData): NativeMessage => ({
    action: "TabFocused",
    data,
  }),

  tabUnfocused: (data: TabActionData): NativeMessage => ({
    action: "TabUnfocused",
    data,
  }),

  tabClosed: (data: TabActionData): NativeMessage => ({
    action: "TabClosed",
    data,
  }),

  start: (session_name: string): NativeMessage => ({
    action: "Start",
    data: { session_name },
  }),

  stop: (): NativeMessage => ({
    action: "Stop",
  }),

  getData: (): NativeMessage => ({
    action: "GetData",
  }),

  getActive: (): NativeMessage => ({
    action: "GetActive",
  }),

  ping: (): NativeMessage => ({
    action: "Ping",
  }),

  getSessions: (): NativeMessage => ({
    action: "GetSessions",
  }),

  deleteSession: (session_name: string): NativeMessage => ({
    action: "DeleteSession",
    data: { session_name },
  }),
};

export interface TabActionData {
  url: string;
  tab_id: number;
}

export type NativeMessage =
  | { action: "TabFocused"; data: TabActionData }
  | { action: "TabUnfocused"; data: TabActionData }
  | { action: "TabClosed"; data: TabActionData }
  | { action: "Start"; data: { session_name: string } }
  | { action: "Stop" }
  | { action: "GetData" }
  | { action: "GetActive" }
  | { action: "Ping" }
  | { action: "GetSessions" }
  | { action: "DeleteSession"; data: { session_name: string } };

export type SuccessNativeResponse = {
  success: true;
  data: Record<string, unknown> | null;
};

export type FailureNativeResponse = {
  success: false;
  error: string | null;
};

export type NativeResponse = SuccessNativeResponse | FailureNativeResponse;
export type SuccessNativeResponseWithData = Omit<
  SuccessNativeResponse,
  "data"
> & {
  data: Record<string, unknown>;
};

export type NativeMessageHandler = (response: NativeResponse) => void;

export class NativeMessagingService {
  private static instance: NativeMessagingService;
  private port: chrome.runtime.Port | null = null;
  private readonly hostName = "browser_timer";
  private messageHandlers: Map<
    number,
    {
      handler: NativeMessageHandler;
      sent_at: number;
      rejecter?: (error: Error) => void;
    }
  > = new Map();
  private messageId = 0;
  private readonly MESSAGE_TIMEOUT_MS = 30000;

  private constructor() {}

  public static getInstance(): NativeMessagingService {
    if (!NativeMessagingService.instance) {
      NativeMessagingService.instance = new NativeMessagingService();
    }
    return NativeMessagingService.instance;
  }

  public connect(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        this.port = chrome.runtime.connectNative(this.hostName);
        if (!this.port) {
          reject(new Error("Failed to create native messaging port"));
          return;
        }
        console.log("Port created successfully");

        this.port.onMessage.addListener((message: NativeResponse) => {
          this.handleMessage(message);
        });

        this.port.onDisconnect.addListener(() => {
          console.log("Native messaging host disconnected");
          if (chrome.runtime.lastError) {
            console.error(
              "Connection error:",
              chrome.runtime.lastError.message
            );
            reject(new Error(chrome.runtime.lastError.message));
          }
          this.port = null;
        });
        setTimeout(() => {
          if (this.port) {
            console.log("Sending ping to verify connection...");
            this.sendMessage(MessageBuilder.ping())
              .then(() => {
                console.log("Ping successful - connection established");
                resolve(true);
              })
              .catch((e) => {
                console.error("Ping failed:", e);
                reject(new Error(`Failed to establish connection: ${e}`));
              });
          }
        }, 100);
      } catch (error) {
        reject(error);
      }
    });
  }

  public sendMessage(message: NativeMessage): Promise<NativeResponse> {
    return new Promise((resolve, reject) => {
      if (!this.port) {
        reject(new Error("Not connected to native host"));
        return;
      }

      const messageId = ++this.messageId;
      const messageWithId = { ...message, id: messageId };

      this.messageHandlers.set(messageId, {
        handler: (response: NativeResponse) => {
          this.messageHandlers.delete(messageId);
          resolve(response);
        },
        sent_at: Date.now(),
        rejecter: reject,
      });

      try {
        this.port.postMessage(messageWithId);
      } catch (error) {
        this.messageHandlers.delete(messageId);
        reject(error);
      }
    });
  }

  private handleMessage(response: NativeResponse & { id?: number }) {
    if (response.id && this.messageHandlers.has(response.id)) {
      const handler = this.messageHandlers.get(response.id)!;
      if (Date.now() - handler.sent_at > this.MESSAGE_TIMEOUT_MS) {
        if (handler.rejecter !== undefined)
          handler.rejecter(new Error("Message timed-out"));
        return;
      }
      handler.handler(response);
    } else {
      console.log("Received unhandled message:", response);
    }
  }

  public disconnect(): void {
    if (this.port !== null) {
      this.port.disconnect();
      this.port = null;
    }
    this.messageHandlers.clear();
  }

  public rejectTimedoutMessages(): void {
    const now = Date.now();
    for (let entry of this.messageHandlers) {
      const v = entry[1];
      if (
        now - v.sent_at > this.MESSAGE_TIMEOUT_MS &&
        v.rejecter !== undefined
      ) {
        v.rejecter(new Error("Message timed-out"));
        v.rejecter = undefined;
        this.messageHandlers.delete(entry[0]);
      }
    }
  }

  public isConnected(): boolean {
    return this.port !== null;
  }
}
