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
    logError(`Native message send failed: ${(e as Error).message}`);
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
  (message: Message, _, sendResponse: (result: NativeResponse) => void) => {
    if (!nativeMessaging.isConnected()) {
      logError(
        "No connection to native host. Make sure it is running. Check error logs for details if any."
      );
      sendResponse({
        success: false,
        error:
          "No connection to native host. Make sure it is running. Check error logs for details if any.",
      });
      return false;
    }
    void handleMessage(message)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
);

function handleMessage(message: Message): Promise<NativeResponse> {
  switch (message.action) {
    case Action.GET_DATA: {
      return nativeMessaging.sendMessage(MessageBuilder.getData());
    }
    case Action.START: {
      return nativeMessaging.sendMessage(
        MessageBuilder.start(message.body.sessionName)
      );
    }
    case Action.STOP: {
      return nativeMessaging.sendMessage(MessageBuilder.stop());
    }
    case Action.GET_ACTIVE: {
      return nativeMessaging.sendMessage(MessageBuilder.getActive());
    }
    case Action.GET_SESSIONS: {
      return nativeMessaging.sendMessage(MessageBuilder.getSessions());
    }
    case Action.DELETE_SESSION: {
      return nativeMessaging.sendMessage(
        MessageBuilder.deleteSession(message.body.sessionName)
      );
    }
    default: {
      logError(`Unsupported message received in handler: ${message.action}`);
      throw new Error(
        `Unsupported message received in handler: ${message.action}`
      );
    }
  }
}
