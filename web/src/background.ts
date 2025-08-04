import {
  MessageBuilder,
  NativeMessagingService,
  type NativeMessage,
  type NativeResponse,
} from "./connection_service";

export const Action = {
  START: 1,
  STOP: 2,
  GET_DATA: 3,
  GET_ACTIVE: 4,
  PING: 5,
  TAB_FOCUSED: 6,
  TAB_UNFOCUSED: 7,
  TAB_CLOSED: 8,
  GET_SESSIONS: 9,
  DELETE_SESSION: 10,
} as const;

export type Action = (typeof Action)[keyof typeof Action];

export interface Message {
  action: Action;
  body: {
    [key: string]: any;
  };
}

export interface TrackingData {
  path: string;
  aggregateTime: number;
  totalInstances: number;
  activeInstances: number;
}

chrome.alarms.onAlarm.addListener((_) => {
  if (nativeMessaging.isConnected()) {
    nativeMessaging.rejectTimedoutMessages();
  }
});

chrome.alarms.create("clearTimedout", {
  delayInMinutes: 5,
});

chrome.runtime.onInstalled.addListener(async () => {
  console.log(
    "BrowserTimer_init: Working as intended. Click the script icon to start."
  );
  await initializeNativeMessaging();
});

const nativeMessaging = NativeMessagingService.getInstance();

async function initializeNativeMessaging() {
  try {
    await nativeMessaging.connect();
    console.log("Connected to native messaging host");
  } catch (error) {
    logError(`Failed to connect to native host ${error}`);
  }
}

function logError(errorMessage: string | undefined) {
  console.error("BrowserTimer error: ", errorMessage ?? "Unknown error");
}

const knownTabs = new Map<number, string>(); // tabId -> url
const activeTabs = new Map<number, number>(); // windowId -> tabId

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (!nativeMessaging.isConnected()) return;
  void handleTabActivation(activeInfo);
});
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (!nativeMessaging.isConnected()) return;
  handleTabRemoval(tabId, removeInfo);
});
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!nativeMessaging.isConnected()) return;
  handleTabUpdate(tabId, changeInfo, tab);
});

async function sendNativeAndLogError(message: NativeMessage) {
  try {
    await nativeMessaging.sendMessage(message);
  } catch (e) {
    logError(`Native message send failed: ${e}`);
  }
}

async function sendNativeWithResponse(
  message: NativeMessage,
  response: (body: NativeResponse | Error) => void
) {
  try {
    const res = await nativeMessaging.sendMessage(message);
    response(res);
  } catch (e) {
    response(e as Error);
  }
}

async function handleTabActivation(activeInfo: chrome.tabs.TabActiveInfo) {
  const { tabId, windowId } = activeInfo;
  // Unfocus old
  const previousTabId = activeTabs.get(windowId);
  if (previousTabId !== undefined && previousTabId !== tabId) {
    const prevUrl = knownTabs.get(previousTabId);
    if (prevUrl !== undefined) {
      await sendNativeAndLogError(
        MessageBuilder.tabUnfocused({ url: prevUrl, tab_id: previousTabId })
      );
    } else {
      logError("Tab tracking state error - active/known mismatch");
    }
  }
  // Activate new one
  activeTabs.set(windowId, tabId);
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url !== undefined) {
      knownTabs.set(tabId, tab.url);
      await sendNativeAndLogError(
        MessageBuilder.tabUnfocused({ url: tab.url, tab_id: tabId })
      );
    } else {
      console.log(`Tab ${tabId} activated with no URL yet`);
    }
  } catch (e) {
    console.warn(`Could not get tab ${tabId}:`, e);
  }
}

async function handleTabUpdate(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
) {
  if (changeInfo.url !== undefined) {
    const oldUrl = knownTabs.get(tabId);
    if (oldUrl !== undefined && oldUrl !== changeInfo.url) {
      // URL changed
      await sendNativeAndLogError(
        MessageBuilder.tabUnfocused({ url: oldUrl, tab_id: tabId })
      );
    }
    knownTabs.set(tabId, changeInfo.url);
    if (activeTabs.get(tab.windowId) === tabId)
      await sendNativeAndLogError(
        MessageBuilder.tabFocused({ url: changeInfo.url, tab_id: tabId })
      );
  }
}

async function handleTabRemoval(
  tabId: number,
  removeInfo: chrome.tabs.TabRemoveInfo
) {
  const url = knownTabs.get(tabId);
  if (url !== undefined) {
    await sendNativeAndLogError(
      MessageBuilder.tabClosed({ url: url, tab_id: tabId })
    );
  } else {
    console.warn(`Tab ${tabId} closed with unknown URL`);
  }
  knownTabs.delete(tabId);
  // Clean up if active
  if (activeTabs.get(removeInfo.windowId) === tabId)
    activeTabs.delete(removeInfo.windowId);
}

chrome.runtime.onMessage.addListener(
  async (message: Message, _, sendResponse) => {
    if (!nativeMessaging.isConnected()) {
      alert(
        "No connection to native host. Make sure it is running. Check error logs for details if any."
      );
      sendResponse(undefined);
      return false;
    }
    switch (message.action) {
      case Action.GET_DATA: {
        void sendNativeWithResponse(MessageBuilder.getData(), sendResponse);
        return true;
      }
      case Action.START: {
        void sendNativeWithResponse(
          MessageBuilder.start(message.body.sessionName),
          sendResponse
        );
        return true;
      }
      case Action.STOP: {
        void sendNativeWithResponse(MessageBuilder.stop(), sendResponse);
        return true;
      }
      case Action.GET_ACTIVE: {
        void sendNativeWithResponse(MessageBuilder.getActive(), sendResponse);
        return true;
      }
      case Action.GET_SESSIONS: {
        void sendNativeWithResponse(MessageBuilder.getSessions(), sendResponse);
        return true;
      }
      case Action.DELETE_SESSION: {
        void sendNativeWithResponse(
          MessageBuilder.deleteSession(message.body.sessionName),
          sendResponse
        );
        return true;
      }
      default: {
        logError(`Unsupported message received in handler: ${message.action}`);
        sendResponse(undefined);
        return false;
      }
    }
  }
);
