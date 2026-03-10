import { useState } from "react";

export default function AgentSettingsSurface({
  settings,
  userId,
  onSettingChange,
  onSave,
  onSendMorning,
  onSendNudge,
  onSendEvening,
  onRunScheduler,
  onLoadDebug,
  debugData,
  debugLoading,
  schedulerRunning,
  sending,
  connection,
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const recentCaptures = debugData?.captures || [];
  const recentMessages = debugData?.agentMessages || [];
  const recentEvents = debugData?.taskEvents || [];

  return (
    <section className="settingsSurface">
      <article className="cardShell settingsCard">
        <h2>Settings</h2>
        <p className="subtle">Configure when and how your AI assistant communicates.</p>

        <div className="connectionStatusRow">
          <span>WhatsApp</span>
          <strong>{connection.statusLabel}</strong>
        </div>
        {connection.detail ? <p className="subtle">{connection.detail}</p> : null}

        {connection.agentWhatsAppFrom && settings.whatsAppTo ? (
          <div style={{ marginTop: "0.5rem" }}>
            <p className="subtle">Tap below to activate WhatsApp messaging. This sends a one-time "Start" message so the agent can reach you.</p>
            <a
              href={`https://wa.me/${connection.agentWhatsAppFrom.replace(/[^0-9]/g, "")}?text=Start`}
              target="_blank"
              rel="noopener noreferrer"
              className="primaryButton mini"
              style={{ display: "inline-block", textDecoration: "none", marginTop: "0.4rem" }}
            >
              Connect WhatsApp
            </a>
          </div>
        ) : null}

        <div className="settingsGrid">
          <label>
            <span className="inputLabel">Morning brief</span>
            <input
              className="textInput"
              type="time"
              value={settings.morningBriefTime}
              onChange={(event) => onSettingChange("morningBriefTime", event.target.value)}
            />
          </label>
          <label>
            <span className="inputLabel">Midday nudge</span>
            <input
              className="textInput"
              type="time"
              value={settings.middayNudgeTime}
              onChange={(event) => onSettingChange("middayNudgeTime", event.target.value)}
            />
          </label>
          <label>
            <span className="inputLabel">Afternoon follow-up</span>
            <input
              className="textInput"
              type="time"
              value={settings.afternoonFollowupTime}
              onChange={(event) => onSettingChange("afternoonFollowupTime", event.target.value)}
            />
          </label>
          <label>
            <span className="inputLabel">Evening check-in</span>
            <input
              className="textInput"
              type="time"
              value={settings.eveningCheckinTime}
              onChange={(event) => onSettingChange("eveningCheckinTime", event.target.value)}
            />
          </label>
          <label>
            <span className="inputLabel">Work starts</span>
            <input
              className="textInput"
              type="time"
              value={settings.workdayStart}
              onChange={(event) => onSettingChange("workdayStart", event.target.value)}
            />
          </label>
          <label>
            <span className="inputLabel">Work ends</span>
            <input
              className="textInput"
              type="time"
              value={settings.workdayEnd}
              onChange={(event) => onSettingChange("workdayEnd", event.target.value)}
            />
          </label>
          <label>
            <span className="inputLabel">Tone</span>
            <select
              className="select"
              value={settings.tone}
              onChange={(event) => onSettingChange("tone", event.target.value)}
            >
              <option value="gentle">Gentle</option>
              <option value="firm">Firm</option>
              <option value="ruthless">Ruthless</option>
            </select>
          </label>
          <label>
            <span className="inputLabel">Nudge intensity</span>
            <select
              className="select"
              value={settings.nudgeIntensity}
              onChange={(event) => onSettingChange("nudgeIntensity", event.target.value)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>

        <div className="settingsToggleRow">
          <label className="noteToggle">
            <input
              type="checkbox"
              checked={settings.weekendsEnabled}
              onChange={(event) => onSettingChange("weekendsEnabled", event.target.checked)}
            />
            Include weekends
          </label>
          <label className="noteToggle">
            <input
              type="checkbox"
              checked={settings.autoplanEnabled}
              onChange={(event) => onSettingChange("autoplanEnabled", event.target.checked)}
            />
            Auto-plan daily
          </label>
        </div>

        <div className="cardShell calendarCard" style={{ marginTop: "1rem", padding: "1rem" }}>
          <h3>Google Calendar</h3>
          {settings.googleCalendarConnected ? (
            <div>
              <p className="subtle" style={{ color: "#25d366" }}>Connected</p>
              <p className="subtle">Events from your calendar will appear in daily messages.</p>
              <button
                type="button"
                className="ghostButton mini"
                onClick={() => {
                  onSettingChange("googleRefreshToken", "");
                  onSettingChange("googleCalendarConnected", false);
                }}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div>
              <p className="subtle">Connect to include calendar events in your daily briefs.</p>
              <button
                type="button"
                className="primaryButton mini"
                onClick={() => {
                  const url = `/api/agent/settings?gcal_auth=1&userId=${encodeURIComponent(userId)}`;
                  window.open(url, "_blank");
                }}
              >
                Connect Google Calendar
              </button>
            </div>
          )}
        </div>

        <div className="settingsActions">
          <button type="button" className="primaryButton" onClick={onSave}>
            Save settings
          </button>
        </div>

        <div className="settingsAdvancedToggle">
          <button
            type="button"
            className="ghostButton mini"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? "Hide advanced" : "Advanced"}
          </button>
        </div>

        {showAdvanced ? (
          <div className="settingsAdvancedPanel">
            <div className="settingsGrid">
              <label>
                <span className="inputLabel">Timezone</span>
                <input
                  className="textInput"
                  value={settings.timezone}
                  onChange={(event) => onSettingChange("timezone", event.target.value)}
                />
              </label>
              <label>
                <span className="inputLabel">WhatsApp number</span>
                <input
                  className="textInput"
                  value={settings.whatsAppTo}
                  onChange={(event) => onSettingChange("whatsAppTo", event.target.value)}
                  placeholder="whatsapp:+91..."
                />
              </label>
            </div>

            <div className="settingsActions">
              <button type="button" className="ghostButton" onClick={onSendMorning} disabled={sending}>
                Send morning brief
              </button>
              <button type="button" className="ghostButton" onClick={onSendNudge} disabled={sending}>
                Send nudge
              </button>
              <button type="button" className="ghostButton" onClick={onSendEvening} disabled={sending}>
                Send evening check-in
              </button>
              <button type="button" className="ghostButton" onClick={onRunScheduler} disabled={schedulerRunning}>
                {schedulerRunning ? "Running..." : "Run scheduler"}
              </button>
              <button type="button" className="ghostButton" onClick={onLoadDebug} disabled={debugLoading}>
                {debugLoading ? "Loading..." : "Debug logs"}
              </button>
            </div>

            {debugData ? (
              <div className="settingsDebugGrid">
                <div className="settingsDebugCard">
                  <h4>Captures</h4>
                  {recentCaptures.slice(0, 8).map((item) => (
                    <p key={item.id} className="subtle">
                      {item.parsed_intent || "unknown"} · {item.raw_text}
                    </p>
                  ))}
                </div>
                <div className="settingsDebugCard">
                  <h4>Messages</h4>
                  {recentMessages.slice(0, 8).map((item) => (
                    <p key={item.id} className="subtle">
                      {item.type} · {item.body}
                    </p>
                  ))}
                </div>
                <div className="settingsDebugCard">
                  <h4>Events</h4>
                  {recentEvents.slice(0, 8).map((item) => (
                    <p key={item.id} className="subtle">
                      {item.event_type} · {item.task_id}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </article>
    </section>
  );
}
