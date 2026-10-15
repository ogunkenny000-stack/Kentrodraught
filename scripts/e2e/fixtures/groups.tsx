// Test-only entry point. Vite production builds use index.html, never this file.
import React from "react";
import { createRoot } from "react-dom/client";
import { GlobalChatLounge } from "../../../src/components/GlobalChatLounge";
import "../../../src/index.css";
const username = new URLSearchParams(location.search).get("user") || "alice";
createRoot(document.getElementById("root")!).render(
  <div style={{ height: "100dvh" }}>
    <GlobalChatLounge username={username} onlineUsers={["alice", "bob"]} />
  </div>,
);
