import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App.jsx";
import "./styles.css";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    // keep this for local debugging
    console.error("Root render error:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
          <h2 style={{ marginTop: 0 }}>App failed to load</h2>
          <p style={{ marginBottom: 8 }}>
            Check `.env.local` and refresh. Runtime error:
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "#f6f6f6",
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: 12,
            }}
          >
            {String(this.state.error?.message || this.state.error)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
const root = ReactDOM.createRoot(document.getElementById("root"));

if (!PUBLISHABLE_KEY) {
  root.render(
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h2 style={{ marginTop: 0 }}>Missing Clerk key</h2>
      <p>
        Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in <code>.env.local</code> and restart
        the dev server.
      </p>
    </div>
  );
} else {
  root.render(
    <React.StrictMode>
      <RootErrorBoundary>
        <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
          <App />
        </ClerkProvider>
      </RootErrorBoundary>
    </React.StrictMode>
  );
}
