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

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  const formatUrl = (url: string) => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname + urlObj.pathname;
    } catch {
      return url;
    }
  };

  if (!data || data.length === 0) {
    return (
      <div style={styles.emptyState}>
        <div style={styles.emptyIcon}>📊</div>
        <h3>No tracking data available</h3>
        <p>Start browsing to see your website usage statistics.</p>
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => b.aggregate_time - a.aggregate_time);
  const totalTime = sorted.reduce(
    (sum, entry) => sum + entry.aggregate_time,
    0
  );
  const maxTime = sorted[0]?.aggregate_time || 1;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Website Usage Statistics</h2>
        <div style={styles.summary}>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>Total Time</span>
            <span style={styles.summaryValue}>{formatTime(totalTime)}</span>
          </div>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>Sites Tracked</span>
            <span style={styles.summaryValue}>{sorted.length}</span>
          </div>
        </div>
      </div>

      <div style={styles.chartContainer}>
        {sorted.map((entry, i) => {
          const percentage = (entry.aggregate_time / maxTime) * 100;
          const timePercentage = (entry.aggregate_time / totalTime) * 100;

          return (
            <div key={i} style={styles.chartItem}>
              <div style={styles.siteInfo}>
                <div style={styles.siteHeader}>
                  <span style={styles.rank}>#{i + 1}</span>
                  <span style={styles.siteName} title={entry.path}>
                    {formatUrl(entry.path)}
                  </span>
                  <span style={styles.percentage}>
                    {timePercentage.toFixed(1)}%
                  </span>
                </div>

                <div style={styles.progressBar}>
                  <div
                    style={{
                      ...styles.progressFill,
                      width: `${percentage}%`,
                      backgroundColor: `hsl(${220 - i * 15}, 70%, 50%)`,
                    }}
                  />
                </div>

                <div style={styles.siteStats}>
                  <div style={styles.stat}>
                    <span style={styles.statIcon}>⏱️</span>
                    <span>{formatTime(entry.aggregate_time)}</span>
                  </div>
                  <div style={styles.stat}>
                    <span style={styles.statIcon}>📱</span>
                    <span>{entry.total_instances} tabs</span>
                  </div>
                  <div style={styles.stat}>
                    <span style={styles.statIcon}>✅</span>
                    <span>{entry.active_instances} active</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  container: {
    padding: "20px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    backgroundColor: "#f8fafc",
    minHeight: "100vh",
  },

  header: {
    marginBottom: "30px",
    textAlign: "center" as const,
  },

  title: {
    fontSize: "28px",
    fontWeight: "700",
    color: "#1e293b",
    margin: "0 0 20px 0",
    maxWidth: "600px",
  },

  summary: {
    display: "flex",
    gap: "30px",
    marginBottom: "10px",
    justifyContent: "center",
  },

  summaryItem: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "5px",
  },

  summaryLabel: {
    fontSize: "14px",
    color: "#64748b",
    fontWeight: "500",
  },

  summaryValue: {
    fontSize: "20px",
    fontWeight: "700",
    color: "#1e293b",
  },

  chartContainer: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "16px",
  },

  chartItem: {
    backgroundColor: "white",
    borderRadius: "12px",
    padding: "20px",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
    border: "1px solid #e2e8f0",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
    cursor: "default",
  },

  siteInfo: {
    width: "100%",
  },

  siteHeader: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "12px",
  },

  rank: {
    fontSize: "14px",
    fontWeight: "600",
    color: "#6366f1",
    backgroundColor: "#eef2ff",
    padding: "4px 8px",
    borderRadius: "6px",
    minWidth: "32px",
    textAlign: "center" as const,
  },

  siteName: {
    fontSize: "16px",
    fontWeight: "600",
    color: "#1e293b",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },

  percentage: {
    fontSize: "14px",
    fontWeight: "600",
    color: "#059669",
    backgroundColor: "#d1fae5",
    padding: "4px 8px",
    borderRadius: "6px",
  },

  progressBar: {
    height: "8px",
    backgroundColor: "#e2e8f0",
    borderRadius: "4px",
    overflow: "hidden",
    marginBottom: "16px",
  },

  progressFill: {
    height: "100%",
    borderRadius: "4px",
    transition: "width 0.3s ease",
  },

  siteStats: {
    display: "flex",
    gap: "24px",
  },

  stat: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "14px",
    color: "#475569",
  },

  statIcon: {
    fontSize: "16px",
  },

  emptyState: {
    textAlign: "center" as const,
    padding: "60px 20px",
    color: "#64748b",
  },

  emptyIcon: {
    fontSize: "48px",
    marginBottom: "16px",
  },
};
