import React from "react";
import { type TrackingData } from "../background";

interface ResultsProps {
  data: TrackingData[] | undefined;
}

export default function Results({ data }: ResultsProps) {
  const formatTime = (ms: number) => {
    let tmp = ms / 1000;
    const seconds = Math.floor(tmp) % 60;
    tmp /= 60;
    const minutes = Math.floor(tmp) % 60;
    tmp /= 60;
    const hours = Math.floor(tmp);
    return `${hours}h ${minutes}m ${seconds}s`;
  };

  if (!data || data.length === 0) {
    return <div>No data yet.</div>;
  }

  const sorted = [...data].sort((a, b) => b.aggregate_time - a.aggregate_time);

  return (
    <div id="results">
      {sorted.map((entry, i) => (
        <div key={i} className="url-entry" style={{ marginBottom: "1rem" }}>
          <div className="path" style={{ fontWeight: "bold" }}>
            {entry.path}
          </div>
          <div className="time">Time: {formatTime(entry.aggregate_time)}</div>
          <div className="instances">
            Active/Tracked instances: {entry.active_instances}/
            {entry.total_instances}
          </div>
        </div>
      ))}
    </div>
  );
}
