import React, { useEffect, useState } from "react";
import { Action } from "../background";
import Results from "../result_view/result_view.tsx";

export default function Popup() {
  const [sessions, setSessions] = useState<string[]>([]);
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [newSessionName, setNewSessionName] = useState("");
  const [selectedSession, setSelectedSession] = useState("");
  const [resultsShowing, setResultsShowing] = useState<boolean>(false);

  useEffect(() => {
    refreshSessions();
  }, []);

  const refreshSessions = () => {
    chrome.runtime.sendMessage(
      { action: Action.GET_ACTIVE },
      (sessionName: string | undefined | null) => {
        if (!sessionName) {
          setCurrentSession(null);
          chrome.storage.local.get(null, (data) => setSessions(Object.keys(data)));
        } else {
          setCurrentSession(sessionName);
        }
      }
    );
  };

  const loadSession = async () => {
    if (selectedSession && selectedSession.length > 0) {
      await chrome.runtime.sendMessage({
        action: Action.START,
        body: { sessionName: selectedSession },
      });
      refreshSessions();
    }
  };

  const createSession = async () => {
    const name = newSessionName.trim();
    if (name.length > 0) {
      await chrome.runtime.sendMessage({
        action: Action.START,
        body: { sessionName: name },
      });
      setNewSessionName("");
      refreshSessions();
    }
  };

  const stopSession = async () => {
    await chrome.runtime.sendMessage({ action: Action.STOP });
    setResultsShowing(false);
    refreshSessions();
  };

  return (
    <div style={{ padding: "1rem", width: "250px" }}>
      {currentSession ? (
        <div id="ifAny">
          <h4>Current session:</h4>
          <p id="currentSession">{currentSession}</p>
          <button onClick={stopSession}>Stop Session</button>
          <button onClick={(_) => setResultsShowing(!resultsShowing)}>Toggle results</button>
          {resultsShowing && (
            <Results />
          )}
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
