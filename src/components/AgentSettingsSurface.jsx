export default function AgentSettingsSurface({
  settings,
  onSettingChange,
  onSave,
  onSendMorning,
  onSendNudge,
  onSendEvening,
  sending,
  connection,
}) {
  return (
    <section className="settingsSurface">
      <article className="cardShell settingsCard">
        <div className="sectionHeader">
          <div>
            <h2>Agent Settings</h2>
            <p>Configure your WhatsApp execution agent behavior.</p>
          </div>
        </div>

        <div className="connectionStatusRow">
          <span>WhatsApp/Twilio</span>
          <strong>{connection.statusLabel}</strong>
        </div>
        <p className="subtle">{connection.detail}</p>

        <div className="settingsGrid">
          <label>
            <span className="inputLabel">Morning brief time</span>
            <input
              className="textInput"
              type="time"
              value={settings.morningBriefTime}
              onChange={(event) => onSettingChange("morningBriefTime", event.target.value)}
            />
          </label>
          <label>
            <span className="inputLabel">Evening check-in time</span>
            <input
              className="textInput"
              type="time"
              value={settings.eveningCheckinTime}
              onChange={(event) => onSettingChange("eveningCheckinTime", event.target.value)}
            />
          </label>
          <label>
            <span className="inputLabel">Working hours start</span>
            <input
              className="textInput"
              type="time"
              value={settings.workdayStart}
              onChange={(event) => onSettingChange("workdayStart", event.target.value)}
            />
          </label>
          <label>
            <span className="inputLabel">Working hours end</span>
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
              <option value="gentle">gentle</option>
              <option value="firm">firm</option>
              <option value="ruthless">ruthless</option>
            </select>
          </label>
          <label>
            <span className="inputLabel">Nudging intensity</span>
            <select
              className="select"
              value={settings.nudgeIntensity}
              onChange={(event) => onSettingChange("nudgeIntensity", event.target.value)}
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
          <label>
            <span className="inputLabel">Timezone</span>
            <input
              className="textInput"
              value={settings.timezone}
              onChange={(event) => onSettingChange("timezone", event.target.value)}
            />
          </label>
          <label>
            <span className="inputLabel">WhatsApp recipient (testing)</span>
            <input
              className="textInput"
              value={settings.whatsAppTo}
              onChange={(event) => onSettingChange("whatsAppTo", event.target.value)}
              placeholder="whatsapp:+91..."
            />
          </label>
        </div>

        <div className="settingsToggleRow">
          <label className="noteToggle">
            <input
              type="checkbox"
              checked={settings.weekendsEnabled}
              onChange={(event) => onSettingChange("weekendsEnabled", event.target.checked)}
            />
            Weekends enabled
          </label>
          <label className="noteToggle">
            <input
              type="checkbox"
              checked={settings.autoplanEnabled}
              onChange={(event) => onSettingChange("autoplanEnabled", event.target.checked)}
            />
            Autoplan enabled
          </label>
        </div>

        <div className="settingsActions">
          <button type="button" className="primaryButton" onClick={onSave}>
            Save settings
          </button>
          <button type="button" className="ghostButton" onClick={onSendMorning} disabled={sending}>
            Send morning brief now
          </button>
          <button type="button" className="ghostButton" onClick={onSendNudge} disabled={sending}>
            Send latest nudge
          </button>
          <button type="button" className="ghostButton" onClick={onSendEvening} disabled={sending}>
            Send evening check-in now
          </button>
        </div>
      </article>
    </section>
  );
}
