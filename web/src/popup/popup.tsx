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
      if (!result.success) alert("Failed to load the session: " + result.error);
      else setCurrentSession(selectedSession);
    }
  };

  const deleteSession = async () => {
    if (selectedSession && selectedSession.length > 0) {
      const result = await sendMessageToWorker(Action.DELETE_SESSION, {
        sessionName: selectedSession,
      });
      if (!result.success)
        alert("Failed to delete the session: " + result.error);
      else {
        alert(`Session ${selectedSession} removed`);
        setSelectedSession("");
        await listSessions();
      }
    }
  };

  const backupSession = async () => {
    if (selectedSession && selectedSession.length > 0) {
      const result = await sendMessageToWorker(Action.BACKUP_SESSION, {
        sessionName: selectedSession,
      });
      if (!result.success)
        alert("Failed to backup the session: " + result.error);
      else {
        alert(
          `Created a copy of session ${selectedSession} under path: ` +
            (result as SuccessNativeResponseWithData).data.path
        );
      }
    }
  };

  const createSession = async () => {
    const name = newSessionName.trim();
    if (name.length > 0) {
      const result = await sendMessageToWorker(Action.START, {
        sessionName: name,
      });
      if (!result.success) alert("Failed to load the session: " + result.error);
      else {
        setCurrentSession(name);
        setNewSessionName("");
      }
    }
  };

  const stopSession = async () => {
    const result = await sendMessageToWorker(Action.STOP);
    if (!result.success) alert("Failed to stop the session: " + result.error);
    else {
      await listSessions();
      setCurrentSession(null);
    }
  };

  const displayActiveSessionStats = async () => {
    const result = await sendMessageToWorker(Action.GET_DATA);
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
    <div style={styles.container}>
      {currentSession ? (
        <div style={styles.sessionContainer}>
          <div style={styles.header}>
            <h2 style={styles.title}>Active Session</h2>
            <div style={styles.sessionCard}>
              <div style={styles.sessionInfo}>
                <span style={styles.sessionLabel}>Current Session</span>
                <span style={styles.sessionName}>{currentSession}</span>
              </div>
            </div>
          </div>

          <div style={styles.buttonGroup}>
            <button className="primary-button" onClick={stopSession}>
              Stop Session
            </button>
            <button
              className="secondary-button"
              onClick={async (_) => {
                if (resultsShowing) {
                  setResultsShowing(false);
                  setSessionData(undefined);
                } else {
                  await displayActiveSessionStats();
                }
              }}
            >
              {resultsShowing ? "Hide Results" : "Show Results"}
            </button>
          </div>

          {resultsShowing && (
            <div>
              <Results data={sessionData} />
            </div>
          )}
        </div>
      ) : (
        <div style={styles.setupContainer}>
          <div style={styles.header}>
            <h2 style={styles.title}>Browser Timer</h2>
            <p style={styles.subtitle}>
              Create a new session or load an existing one to start tracking.
            </p>
          </div>

          <div style={styles.sectionCard}>
            <h3 style={styles.sectionTitle}>
              <span style={styles.sectionIcon}>➕</span>
              Start New Session
            </h3>
            <div style={styles.inputGroup}>
              <input
                type="text"
                placeholder="Enter session name"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                style={styles.input}
              />
              <button
                onClick={createSession}
                className="primary-button"
                disabled={!newSessionName.trim()}
              >
                <span style={styles.buttonIcon}>🚀</span>
                Create Session
              </button>
            </div>
          </div>

          <div style={styles.sectionCard}>
            <h3 style={styles.sectionTitle}>
              <span style={styles.sectionIcon}>📂</span>
              Load Existing Session
            </h3>
            <div style={styles.inputGroup}>
              <select
                value={selectedSession}
                onChange={(e) => setSelectedSession(e.target.value)}
                style={styles.select}
              >
                <option value="">-- Select Session --</option>
                {sessions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <button
                onClick={loadSession}
                disabled={!selectedSession}
                className="primary-button"
              >
                <span style={styles.buttonIcon}>📁</span>
                Load
              </button>
              <button
                onClick={backupSession}
                disabled={!selectedSession}
                style={{ backgroundColor: "#58eb93b0" }}
                className="primary-button"
              >
                💾
              </button>
              <button
                onClick={deleteSession}
                disabled={!selectedSession}
                style={{ backgroundColor: "#E91E63" }}
                className="primary-button"
              >
                🗑
              </button>
            </div>
            {sessions.length === 0 && (
              <p style={styles.emptyMessage}>No saved sessions available.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
const styles = {
  container: {
    padding: "20px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    backgroundColor: "#f8fafc",
    maxWidth: "800px",
    minWidth: "520px",
    margin: "0 auto",
  },

  header: {
    textAlign: "center" as const,
  },

  title: {
    fontSize: "28px",
    fontWeight: "700",
    color: "#1e293b",
    margin: "0 0 10px 0",
  },

  subtitle: {
    fontSize: "16px",
    color: "#64748b",
    margin: "0",
  },

  sessionContainer: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "30px",
  },

  sessionCard: {
    backgroundColor: "white",
    borderRadius: "12px",
    padding: "20px",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
    border: "1px solid #e2e8f0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "16px",
    maxWidth: "400px",
    margin: "0 auto",
  },

  sessionIcon: {
    fontSize: "24px",
    padding: "12px",
    backgroundColor: "#eef2ff",
    borderRadius: "8px",
  },

  sessionInfo: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
  },

  sessionLabel: {
    fontSize: "14px",
    color: "#64748b",
    fontWeight: "500",
  },

  sessionName: {
    fontSize: "18px",
    fontWeight: "600",
    color: "#1e293b",
  },

  buttonGroup: {
    display: "flex",
    gap: "16px",
    justifyContent: "center",
    flexWrap: "wrap" as const,
  },

  setupContainer: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "24px",
  },

  sectionCard: {
    backgroundColor: "white",
    borderRadius: "12px",
    padding: "24px",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
    border: "1px solid #e2e8f0",
  },

  sectionTitle: {
    fontSize: "20px",
    fontWeight: "600",
    color: "#1e293b",
    margin: "0 0 16px 0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
  },

  sectionIcon: {
    fontSize: "20px",
  },

  inputGroup: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap" as const,
  },

  input: {
    flex: "1",
    minWidth: "200px",
    padding: "12px 16px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    fontSize: "16px",
    fontFamily: "inherit",
    backgroundColor: "white",
    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
    outline: "none",
  },

  select: {
    flex: "1",
    maxWidth: "200px",
    textOverflow: "ellipsis",
    padding: "12px 16px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    fontSize: "16px",
    fontFamily: "inherit",
    backgroundColor: "white",
    cursor: "pointer",
    outline: "none",
  },

  buttonIcon: {
    fontSize: "16px",
  },

  emptyMessage: {
    fontSize: "14px",
    color: "#64748b",
    fontStyle: "italic",
    marginTop: "12px",
    margin: "12px 0 0 0",
  },
};
