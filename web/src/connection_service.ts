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

export interface SuccessfulNativeResponse {
  data?: any;
  success: true;
}

export interface NativeResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export type NativeMessageHandler = (response: NativeResponse) => void;

export class NativeMessagingService {
  private static instance: NativeMessagingService;
  private port: chrome.runtime.Port | null = null;
  private readonly hostName = "browser_timer"; // Ttodo
  private messageHandlers: Map<
    string,
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
        this.sendMessage(MessageBuilder.ping())
          .then(() => resolve(true))
          .catch((e) =>
            reject(new Error(`Failed to establish connection: ${e}`))
          );
      } catch (error) {
        reject(error);
      }
    });
  }

  public sendMessage(
    message: NativeMessage
  ): Promise<SuccessfulNativeResponse> {
    return new Promise((resolve, reject) => {
      if (!this.port) {
        reject(new Error("Not connected to native host"));
        return;
      }

      const messageId = (++this.messageId).toString();
      const messageWithId = { ...message, id: messageId };

      this.messageHandlers.set(messageId, {
        handler: (response: NativeResponse) => {
          this.messageHandlers.delete(messageId);
          if (response.success) {
            resolve(response as SuccessfulNativeResponse);
          } else {
            reject(new Error(response.error || "Unknown error"));
          }
        },
        sent_at: Date.now(),
        rejecter: reject
      });

      try {
        this.port.postMessage(messageWithId);
      } catch (error) {
        this.messageHandlers.delete(messageId);
        reject(error);
      }
    });
  }

  private handleMessage(response: NativeResponse & { id?: string }) {
    if (response.id && this.messageHandlers.has(response.id)) {
      const handler = this.messageHandlers.get(response.id)!;
      if(Date.now() - handler.sent_at > this.MESSAGE_TIMEOUT_MS){
        if(handler.rejecter !== undefined) handler.rejecter(new Error("Message timed-out"));
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
    for(let entry of this.messageHandlers){
      const v = entry[1];
      if(now - v.sent_at > this.MESSAGE_TIMEOUT_MS && v.rejecter !== undefined){
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
