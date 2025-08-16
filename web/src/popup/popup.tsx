import React, { useEffect, useState } from "react";
import { Action, type TrackingData } from "../background";
import Results from "../result_view/result_view.tsx";
import type {
  NativeResponse,
  SuccessNativeResponseWithData,
} from "../connection_service.ts";

async function sendMessageToWorker(
  action: Action,
  body?: {
    [key: string]: any;
  }
): Promise<NativeResponse> {
  return await chrome.runtime.sendMessage({
    action,
    body,
  });
}

export default function Popup() {
  const [sessions, setSessions] = useState<string[]>([]);
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<TrackingData[] | undefined>(
    undefined
  );
  const [newSessionName, setNewSessionName] = useState("");
  const [selectedSession, setSelectedSession] = useState("");
  const [resultsShowing, setResultsShowing] = useState<boolean>(false);

  useEffect(() => {
    refreshSessions();
  }, []);

  const refreshSessions = async () => {
    const result = await sendMessageToWorker(Action.GET_ACTIVE);
    console.log("active", result);
    if (!result.success) {
      alert("Failed to fetch data from the host: " + result.error);
    } else {
      if (result.data !== null) {
        const current = result.data.session_name as string;
        setCurrentSession(current);
      } else {
        // no current sessions, fetch all
        await listSessions();
      }
    }
  };

  const listSessions = async () => {
    const result = await sendMessageToWorker(Action.GET_SESSIONS);
    console.log("list", result);
    if (!result.success) {
      alert("Failed to list saved sessions: " + result.error);
    } else {
      const sessions = (result as SuccessNativeResponseWithData).data.sessions;
      if (!sessions) setSessions([]);
      else setSessions(sessions as string[]);
    }
  };

  const loadSession = async () => {
    if (selectedSession && selectedSession.length > 0) {
      const result = await sendMessageToWorker(Action.START, {
        sessionName: selectedSession,
      });
      console.log("load", result);
      if (!result.success) alert("Failed to load the session: " + result.error);
      else setCurrentSession(selectedSession);
    }
  };

  const createSession = async () => {
    const name = newSessionName.trim();
    if (name.length > 0) {
      const result = await sendMessageToWorker(Action.START, {
        sessionName: name,
      });
      console.log("create", result);
      if (!result.success) alert("Failed to load the session: " + result.error);
      else {
        setCurrentSession(name);
        setNewSessionName("");
      }
    }
  };

  const stopSession = async () => {
    const result = await sendMessageToWorker(Action.STOP);
    console.log("stop", result);
    if (!result.success) alert("Failed to stop the session: " + result.error);
    else {
      await listSessions();
      setCurrentSession(null);
    }
  };

  const displayActiveSessionStats = async () => {
    const result = await sendMessageToWorker(Action.GET_DATA);
    console.log("data", result);
    if (!result.success) {
      alert("Failed to fetch the session data: " + result.error);
      setSessionData(undefined);
    } else {
      const data = (result as SuccessNativeResponseWithData).data.data;
      setSessionData(data as TrackingData[] | undefined);
      setResultsShowing(true);
    }
  };

  return (
    <div style={{ padding: "1rem", width: "250px" }}>
      {currentSession ? (
        <div id="ifAny">
          <h4>Current session:</h4>
          <p id="currentSession">{currentSession}</p>
          <button onClick={stopSession}>Stop Session</button>
          <button
            onClick={async (_) => {
              if (resultsShowing) {
                setResultsShowing(false);
                setSessionData(undefined);
              } else {
                await displayActiveSessionStats();
              }
            }}
          >
            Toggle results
          </button>
          {resultsShowing && <Results data={sessionData} />}
        </div>
      ) : (
        <div id="ifNone">
          <h4>Start new session</h4>
          <input
            type="text"
            placeholder="Session name"
            value={newSessionName}
            onChange={(e) => setNewSessionName(e.target.value)}
          />
          <button onClick={createSession}>Create</button>

          <h4>Or load existing:</h4>
          <select
            value={selectedSession}
            onChange={(e) => setSelectedSession(e.target.value)}
          >
            <option value="">-- Select Session --</option>
            {sessions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button onClick={loadSession} disabled={!selectedSession}>
            Load
          </button>
        </div>
      )}
    </div>
  );
}
