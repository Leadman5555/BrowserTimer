export const Action = {
  START: 1,
  STOP: 2,
  GET_DATA: 3,
  GET_ACTIVE: 4,
} as const;

export type Action = (typeof Action)[keyof typeof Action];

export interface TrackingData {
  path: string;
  aggregateTime: number;
  totalInstances: number;
  activeInstances: number;
}

export interface Message {
  action: Action;
  body: {
    [key: string]: any;
  };
}

interface TabInstance {
  tabId: number;
  timeActive: number;
  lastOpened: number | undefined;
}

interface URLInfo {
  subPart: string;
  aggregateTime: number;
  instances: TabInstance[];
  children: Map<string, URLInfo>;
}

interface SerializedURLInfo {
  subPart: string;
  aggregateTime: number;
  instances?: TabInstance[];
  children: { [key: string]: SerializedURLInfo };
}

interface SerializedSession {
  sessionName: string;
  data: { [key: string]: SerializedURLInfo };
}

class Tracker {
  private root: Map<string, URLInfo>;
  private session: string;
  private changedSinceLastSave: boolean = true;

  constructor(
    session: string,
    serialized?: { [key: string]: SerializedURLInfo },
    fresh?: boolean
  ) {
    this.session = session;
    this.root = new Map();
    if (serialized === undefined) return;
    let rebuild: (node: SerializedURLInfo) => URLInfo;
    if (fresh === true) {
      rebuild = (node: SerializedURLInfo): URLInfo => {
        const childrenMap = new Map<string, URLInfo>();
        for (const key in node.children) {
          childrenMap.set(key, rebuild(node.children[key]));
        }
        return {
          subPart: node.subPart,
          aggregateTime: node.aggregateTime,
          instances: [],
          children: childrenMap,
        };
      };
    } else {
      rebuild = (node: SerializedURLInfo): URLInfo => {
        const childrenMap = new Map<string, URLInfo>();
        for (const key in node.children) {
          childrenMap.set(key, rebuild(node.children[key]));
        }
        return {
          subPart: node.subPart,
          aggregateTime: node.aggregateTime,
          instances: node.instances ?? [],
          children: childrenMap,
        };
      };
    }
    for (const key in serialized) {
      this.root.set(key, rebuild(serialized[key]));
    }
  }

  private extractParts(url: string): string[] | undefined {
    if (url.length === 0) return undefined;
    try {
      const u = new URL(url);
      return [u.hostname, ...u.pathname.split("/").filter((p) => p.length > 1)];
    } catch (e) {
      logError(`Error extracting the URL: ${e}`);
      return undefined;
    }
  }

  newTabFocused(url: string, tabId: number) {
    const parts = this.extractParts(url);
    if (parts === undefined) return;
    this.changedSinceLastSave = true;
    const node = this.findOrCreateParent(parts, 0, {
      children: this.root,
    } as URLInfo);
    const existingInstance = node.instances.find(
      (inst) => inst.tabId === tabId
    );
    if (existingInstance !== undefined) {
      if (existingInstance.lastOpened === undefined) {
        existingInstance.lastOpened = Date.now();
      }
    } else {
      node.instances.push({
        tabId,
        timeActive: 0,
        lastOpened: Date.now(),
      });
    }
  }

  private findOrCreateParent(
    urlParts: string[],
    index: number,
    currentRoot: URLInfo
  ): URLInfo {
    let currentParent = currentRoot;
    for (let i = index; i < urlParts.length; i++) {
      let next = currentParent.children.get(urlParts[i]);
      if (next === undefined) {
        for (let j = i; j < urlParts.length; j++) {
          const newNode: URLInfo = {
            subPart: urlParts[j],
            instances: [],
            children: new Map(),
            aggregateTime: 0,
          };
          currentParent.children.set(urlParts[j], newNode);
          currentParent = newNode;
        }
        return currentParent;
      }
      currentParent = next;
    }
    return currentParent;
  }

  private getNodeForURL(urlParts: string[]): URLInfo | undefined {
    let current: URLInfo | undefined = { children: this.root } as URLInfo;
    for (const part of urlParts) {
      const next: URLInfo | undefined = current.children.get(part);
      if (next === undefined) {
        return undefined;
      }
      current = next;
    }

    return current;
  }

  tabUnfocused(url: string, tabId: number) {
    const parts = this.extractParts(url);
    if (parts === undefined) return;
    const node = this.getNodeForURL(parts);
    if (node !== undefined) {
      const instance = node.instances.find(
        (instance) => instance.tabId === tabId
      );
      if (instance !== undefined) {
        this.changedSinceLastSave = true;
        Tracker.accumulateTime(instance, Date.now());
      } else {
        logError(`${tabId} tab is not tracked as active`);
      }
    }
  }

  private static accumulateTime(instance: TabInstance, from: number) {
    if (instance.lastOpened === undefined) return;
    const timeSpan = from - instance.lastOpened;
    instance.lastOpened = undefined;
    instance.timeActive += timeSpan;
  }

  private static accumulateTimeAndReset(
    instance: TabInstance,
    from: number
  ): number {
    if (instance.lastOpened !== undefined) {
      const timeSpan = from - instance.lastOpened;
      instance.lastOpened = from;
      instance.timeActive += timeSpan;
    }
    const total = instance.timeActive;
    instance.timeActive = 0;
    return total;
  }

  tabClosed(url: string, tabId: number) {
    const parts = this.extractParts(url);
    if (parts === undefined) return;
    const node = this.getNodeForURL(parts);
    if (node !== undefined) {
      const instanceIndex = node.instances.findIndex(
        (instance) => instance.tabId === tabId
      );
      if (instanceIndex !== -1) {
        const [instance] = node.instances.splice(instanceIndex, 1);
        Tracker.accumulateTime(instance, Date.now());
        node.aggregateTime += instance.timeActive;
        this.changedSinceLastSave = true;
      } else {
        logError("A closed tab wasn't tracker properly");
      }
    }
  }

  async getAggregateFlatData(sendResponse: ((data: TrackingData[]) => void)) : Promise<void> {
    const result: TrackingData[] = [];
    const stack: { path: string[]; node: URLInfo }[] = [];
    const now = Date.now();
    for (const [key, node] of this.root.entries()) {
      stack.push({ path: [key], node });
    }

    while (stack.length > 0) {
      const { path, node } = stack.pop()!;

      let total = 0;
      let activeInstances = 0;
      for (const instance of node.instances) {
        if (instance.lastOpened !== undefined) activeInstances++;
        total += Tracker.accumulateTimeAndReset(instance, now);
      }
      node.aggregateTime += total;

      if (node.aggregateTime !== 0) {
        result.push({
          path: path.join("/"),
          aggregateTime: node.aggregateTime,
          activeInstances,
          totalInstances: node.instances.length,
        });
      }
      for (const [key, child] of node.children.entries()) {
        stack.push({ path: [...path, key], node: child });
      }
    }
    this.changedSinceLastSave = true;
    sendResponse(result);
  }

  serialize(withTabs: boolean): SerializedSession | undefined {
    if (!this.changedSinceLastSave) return undefined;
    const serializedRoot: { [key: string]: SerializedURLInfo } = {};
    if (withTabs) {
      for (const [key, node] of this.root.entries()) {
        serializedRoot[key] = this.serializeNode(node);
      }
    } else {
      for (const [key, node] of this.root.entries()) {
        serializedRoot[key] = this.serializeNodeWithoutTabs(node);
      }
    }
    this.changedSinceLastSave = false;
    return {
      sessionName: this.session,
      data: serializedRoot,
    };
  }

  private serializeNode(node: URLInfo): SerializedURLInfo {
    const serializedChildren: { [key: string]: SerializedURLInfo } = {};
    for (const [key, child] of node.children.entries()) {
      serializedChildren[key] = this.serializeNode(child);
    }
    let total = 0;
    const now = Date.now();
    for (const instance of node.instances) {
      total += Tracker.accumulateTimeAndReset(instance, now);
    }
    node.aggregateTime += total;
    return {
      subPart: node.subPart,
      aggregateTime: node.aggregateTime,
      instances: node.instances,
      children: serializedChildren,
    };
  }

  private serializeNodeWithoutTabs(node: URLInfo): SerializedURLInfo {
    const serializedChildren: { [key: string]: SerializedURLInfo } = {};
    for (const [key, child] of node.children.entries()) {
      serializedChildren[key] = this.serializeNodeWithoutTabs(child);
    }
    let total = 0;
    const now = Date.now();
    for (const instance of node.instances) {
      total += Tracker.accumulateTimeAndReset(instance, now);
    }
    node.aggregateTime += total;
    return {
      subPart: node.subPart,
      aggregateTime: node.aggregateTime,
      children: serializedChildren,
    };
  }

  get sessionName() {
    return this.session;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log(
    "BrowserTimer_init: Working as intended. Click the script icon to start."
  );
});

function logError(errorMessage: string | undefined) {
  console.error("BrowserTimer error: ", errorMessage ?? "Unknown error");
}

let tracker: Tracker | undefined;
const knownTabs = new Map<number, string>(); // tabId -> url
const activeTabs = new Map<number, number>(); // windowId -> tabId

async function startSession(
  sessionName: string,
  fresh: boolean,
  response?: (body: boolean) => void
) {
  if (tracker !== undefined) {
    console.log(tracker.sessionName);
    logError("Invalid state - please restart the extension");
    if(response !== undefined) response(false);
    return;
  }
  const saved = await chrome.storage.local.get(sessionName);
  const data: { [key: string]: SerializedURLInfo } | undefined =
    saved[sessionName];
  if (data !== undefined) {
    tracker = new Tracker(sessionName, data, fresh);
    console.log(`Resumed session: ${sessionName}`);
  } else {
    tracker = new Tracker(sessionName);
    console.log(`Started a new session: ${sessionName}`);
  }
  void autosaveLoop();
  if (response !== undefined) response(true);
}

async function stopSession(response: (body: boolean) => void) {
  if (tracker === undefined){
    response(false);
    return;
  }
  await saveSession(false);
  await chrome.storage.local.remove("suspendedSession");
  console.log(`Stopped session ${tracker.sessionName}`);
  tracker = undefined;
  response(true);
}

async function saveSession(byAutosave: boolean) {
  if (tracker === undefined) return;
  const serialized = tracker.serialize(byAutosave);
  if (serialized === undefined) return;
  await chrome.storage.local.set({ [serialized.sessionName]: serialized.data });
  if (byAutosave) {
    await chrome.storage.local.set({
      suspendedSession: serialized.sessionName,
    });
    console.log(`Autosaved session ${serialized.sessionName}`);
  }
}

async function loadSuspendedWithResponse(
  response: (sessionName: string | undefined) => void
): Promise<void> {
  await loadSuspended();
  response(tracker?.sessionName);
}

async function loadSuspended(): Promise<boolean> {
  const { suspendedSession } = await chrome.storage.local.get(
    "suspendedSession"
  );
  if (!suspendedSession) {
    return false;
  }
  await startSession(suspendedSession, false);
  return true;
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (tracker === undefined && !(await loadSuspended())) return;
  handleTabActivation(activeInfo).catch(console.error);
});
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (tracker === undefined && !(await loadSuspended())) return;
  handleTabRemoval(tabId, removeInfo);
});
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tracker === undefined && !(await loadSuspended())) return;
  handleTabUpdate(tabId, changeInfo, tab);
});

async function handleTabActivation(activeInfo: chrome.tabs.TabActiveInfo) {
  const { tabId, windowId } = activeInfo;
  // Unfocus old
  const previousTabId = activeTabs.get(windowId);
  if (previousTabId !== undefined && previousTabId !== tabId) {
    const prevUrl = knownTabs.get(previousTabId);
    if (prevUrl !== undefined) {
      tracker!.tabUnfocused(prevUrl, previousTabId);
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
      tracker!.newTabFocused(tab.url, tabId);
    } else {
      console.log(`Tab ${tabId} activated with no URL yet`);
    }
  } catch (e) {
    console.warn(`Could not get tab ${tabId}:`, e);
  }
}

function handleTabUpdate(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
) {
  if (changeInfo.url !== undefined) {
    const oldUrl = knownTabs.get(tabId);
    if (oldUrl !== undefined && oldUrl !== changeInfo.url) {
      // URL changed
      tracker!.tabUnfocused(oldUrl, tabId);
    }
    knownTabs.set(tabId, changeInfo.url);
    if (activeTabs.get(tab.windowId) === tabId)
      tracker!.newTabFocused(changeInfo.url, tabId);
  }
}

function handleTabRemoval(
  tabId: number,
  removeInfo: chrome.tabs.TabRemoveInfo
) {
  const url = knownTabs.get(tabId);
  if (url !== undefined) {
    tracker!.tabClosed(url, tabId);
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
    switch (message.action) {
      case Action.GET_DATA: {
        if(tracker === undefined){
          sendResponse(undefined);
          return false;
        }
        void tracker.getAggregateFlatData(sendResponse);
        return true;
      }
      case Action.START: {
        void startSession(message.body.sessionName, true, sendResponse);
        return true;
      }
      case Action.STOP: {
        void stopSession(sendResponse);
        return true;
      }
      case Action.GET_ACTIVE: {
        if (tracker !== undefined) {
          sendResponse(tracker.sessionName);
          return false;
        } else {
          void loadSuspendedWithResponse(sendResponse);
          return true;
        }
      }
    }
  }
);

let isRunning = false;
const AUTOSAVE_INTERVAL_MS = 2000;

async function autosaveLoop() {
  if (tracker === undefined || isRunning) return;
  isRunning = true;
  while (tracker !== undefined) {
    await new Promise((resolve) => setTimeout(resolve, AUTOSAVE_INTERVAL_MS));
    await saveSession(true);
  }
  isRunning = false;
}
