import React, { useEffect, useState } from "react";
import { Action, type TrackingData } from "../background";

export default function Results() {
  const [data, setData] = useState<TrackingData[] | undefined>(undefined);

  const formatTime = (ms: number) => {
    let tmp = ms / 1000;
    const seconds = Math.floor(tmp) % 60;
    tmp /= 60;
    const minutes = Math.floor(tmp) % 60;
    tmp /= 60;
    const hours = Math.floor(tmp);
    return `${hours}h ${minutes}m ${seconds}s`;
  };

  useEffect(() => {
    chrome.runtime.sendMessage(
      { action: Action.GET_DATA },
      (response: TrackingData[] | undefined) => {
        if (!chrome.runtime.lastError) {
          setData(response);
        } else {
          console.error(
            "Error fetching data:",
            chrome.runtime.lastError.message
          );
        }
      }
    );
  }, []);

  if (!data || data.length === 0) {
    return <div>No data yet.</div>;
  }

  const sorted = [...data].sort((a, b) => b.aggregateTime - a.aggregateTime);

  return (
    <div id="results">
      {sorted.map((entry, i) => (
        <div key={i} className="url-entry" style={{ marginBottom: "1rem" }}>
          <div className="path" style={{ fontWeight: "bold" }}>
            {entry.path}
          </div>
          <div className="time">Time: {formatTime(entry.aggregateTime)}</div>
          <div className="instances">
            Active/Tracked instances: {entry.activeInstances}/
            {entry.totalInstances}
          </div>
        </div>
      ))}
    </div>
  );
}
