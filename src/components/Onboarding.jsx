import { useCallback, useEffect, useRef, useState } from "react";

const INTENTS = [
  { id: "hit_big_goal", emoji: "🎯", label: "Hit a big goal", desc: "You have something specific you want to achieve" },
  { id: "build_habits", emoji: "🔁", label: "Build better habits", desc: "Create routines that stick and compound over time" },
  { id: "stop_overwhelm", emoji: "🧘", label: "Stop feeling overwhelmed", desc: "Get clarity on what matters and let go of the rest" },
  { id: "get_more_done", emoji: "⚡", label: "Get more done each day", desc: "Maximize your output with smart scheduling" },
];

const ENERGY_OPTIONS = [
  { id: "morning", emoji: "🌅", label: "Morning", desc: "I'm sharpest before noon" },
  { id: "midday", emoji: "☀️", label: "Midday", desc: "I hit my stride around lunch" },
  { id: "evening", emoji: "🌙", label: "Evening", desc: "I do my best work after 5 PM" },
];

const GOAL_TEMPLATES = [
  "Launch a side project",
  "Get fit / lose weight",
  "Learn a new skill",
  "Read 20 books this year",
  "Advance my career",
  "Build a daily routine",
];

export default function Onboarding({ userId, getToken, onComplete, agentWhatsAppFrom }) {
  const [step, setStep] = useState(0);
  const [intent, setIntent] = useState("");
  const [goals, setGoals] = useState([{ title: "", targetDate: "" }]);
  const [workdayStart, setWorkdayStart] = useState("09:00");
  const [workdayEnd, setWorkdayEnd] = useState("18:00");
  const [peakEnergy, setPeakEnergy] = useState("");
  const [gcalConnected, setGcalConnected] = useState(false);
  const [whatsAppNumber, setWhatsAppNumber] = useState("");
  const [whatsAppOptedIn, setWhatsAppOptedIn] = useState(false);
  const [firstDayPlan, setFirstDayPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [goalsCreating, setGoalsCreating] = useState(false);
  const pollRef = useRef(null);
  const pollStartRef = useRef(null);

  // Helper to call API with auth
  const apiCall = useCallback(
    async (url, body) => {
      const token = await getToken().catch(() => null);
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ userId, ...body }),
      });
      return res.json();
    },
    [userId, getToken]
  );

  const apiGet = useCallback(
    async (url) => {
      const token = await getToken().catch(() => null);
      const headers = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      return res.json();
    },
    [getToken]
  );

  // Save settings helper
  const saveSettings = useCallback(
    async (fields) => {
      await apiCall("/api/agent/settings", fields);
    },
    [apiCall]
  );

  // Listen for Google Calendar OAuth popup result
  useEffect(() => {
    function handleMessage(event) {
      if (event.data?.type === "gcal_result" && event.data?.status === "connected") {
        setGcalConnected(true);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Poll for WhatsApp onboarding completion
  useEffect(() => {
    if (step !== 5) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollStartRef.current = Date.now();
    pollRef.current = setInterval(async () => {
      try {
        const data = await apiGet(`/api/agent/settings?userId=${encodeURIComponent(userId)}`);
        if (data?.profile?.onboardingCompleted) {
          clearInterval(pollRef.current);
          setStep(6);
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(pollRef.current);
  }, [step, userId, apiGet]);

  // Load first day plan when reaching step 6
  useEffect(() => {
    if (step !== 6 || firstDayPlan) return;
    setLoading(true);
    apiCall("/api/agent/settings", { action: "generate_first_day" })
      .then((data) => {
        if (data?.plan) setFirstDayPlan(data.plan);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [step, firstDayPlan, apiCall]);

  // ─── Step handlers ───

  async function handleIntentNext() {
    if (!intent) return;
    await saveSettings({ onboardingIntent: intent });
    setStep(1);
  }

  async function handleGoalsNext() {
    const validGoals = goals.filter((g) => g.title.trim());
    if (validGoals.length === 0) return;
    setGoalsCreating(true);
    try {
      await apiCall("/api/agent/settings", {
        action: "create_goals",
        goals: validGoals.map((g) => ({
          title: g.title.trim(),
          targetDate: g.targetDate || null,
        })),
      });
    } catch { /* continue anyway */ }
    setGoalsCreating(false);
    setStep(2);
  }

  async function handleScheduleNext() {
    if (!peakEnergy) return;
    await saveSettings({ workdayStart, workdayEnd, peakEnergy });
    setStep(3);
  }

  function handleConnectCalendar() {
    window.open(`/api/agent/settings?gcal_auth=1&userId=${encodeURIComponent(userId)}`, "_blank");
  }

  async function handleWhatsAppNext() {
    const cleaned = whatsAppNumber.trim();
    if (!cleaned) return;
    setLoading(true);
    try {
      await saveSettings({ whatsAppTo: cleaned });
      // Small delay to ensure profile is saved before kickoff reads it
      await new Promise((r) => setTimeout(r, 500));
      await apiCall("/api/agent/settings", { action: "start_whatsapp" });
      setWhatsAppOptedIn(true);
      setStep(5);
    } catch { /* continue */ }
    setLoading(false);
  }

  async function handleSkipOnboarding() {
    await saveSettings({ onboardingCompleted: true });
    onComplete();
  }

  async function handleFinish() {
    await saveSettings({ onboardingCompleted: true });
    onComplete();
  }

  function addGoalSlot() {
    if (goals.length < 3) setGoals([...goals, { title: "", targetDate: "" }]);
  }

  function updateGoal(index, field, value) {
    setGoals((prev) => prev.map((g, i) => (i === index ? { ...g, [field]: value } : g)));
  }

  function useTemplate(template) {
    const emptyIdx = goals.findIndex((g) => !g.title.trim());
    if (emptyIdx >= 0) {
      updateGoal(emptyIdx, "title", template);
    } else if (goals.length < 3) {
      setGoals([...goals, { title: template, targetDate: "" }]);
    }
  }

  const whatsAppTimedOut = step === 5 && pollStartRef.current && Date.now() - pollStartRef.current > 120000;

  // ─── Render ───

  const totalSteps = 7;
  const progress = ((step + 1) / totalSteps) * 100;

  return (
    <div className="onboardingWizard">
      <div className="onboardingProgress">
        <div className="onboardingProgressFill" style={{ width: `${progress}%` }} />
      </div>

      <div className="onboardingContainer">
        {step > 0 && step < 6 && (
          <button className="onboardingBack" onClick={() => setStep((s) => s - 1)}>
            ← Back
          </button>
        )}

        {/* Step 0: Welcome + Intent */}
        {step === 0 && (
          <div className="onboardingStep" key="intent">
            <h1 className="onboardingTitle">What brings you here?</h1>
            <p className="onboardingSubtitle">This helps your PA understand how to support you best.</p>
            <div className="onboardingCards">
              {INTENTS.map((item) => (
                <button
                  key={item.id}
                  className={`onboardingCard ${intent === item.id ? "selected" : ""}`}
                  onClick={() => setIntent(item.id)}
                >
                  <span className="onboardingCardEmoji">{item.emoji}</span>
                  <strong>{item.label}</strong>
                  <span className="onboardingCardDesc">{item.desc}</span>
                </button>
              ))}
            </div>
            <button className="primaryButton" disabled={!intent} onClick={handleIntentNext}>
              Continue
            </button>
            <button className="onboardingSkip" onClick={handleSkipOnboarding}>
              Skip onboarding
            </button>
          </div>
        )}

        {/* Step 1: Goals */}
        {step === 1 && (
          <div className="onboardingStep" key="goals">
            <h1 className="onboardingTitle">What are your goals?</h1>
            <p className="onboardingSubtitle">Add 1-3 goals. We'll break them into daily tasks for you.</p>

            <div className="onboardingGoalInputs">
              {goals.map((goal, i) => (
                <div key={i} className="onboardingGoalRow">
                  <input
                    className="textInput"
                    placeholder={`Goal ${i + 1}, e.g. "Launch my app by September"`}
                    value={goal.title}
                    onChange={(e) => updateGoal(i, "title", e.target.value)}
                  />
                  <input
                    className="textInput onboardingDateInput"
                    type="date"
                    value={goal.targetDate}
                    onChange={(e) => updateGoal(i, "targetDate", e.target.value)}
                  />
                </div>
              ))}
              {goals.length < 3 && (
                <button className="ghostButton mini" onClick={addGoalSlot}>
                  + Add another goal
                </button>
              )}
            </div>

            <div className="onboardingTemplates">
              <span className="onboardingTemplateLabel">Or pick a template:</span>
              <div className="onboardingTemplateChips">
                {GOAL_TEMPLATES.map((t) => (
                  <button key={t} className="onboardingChip" onClick={() => useTemplate(t)}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <button
              className="primaryButton"
              disabled={!goals.some((g) => g.title.trim()) || goalsCreating}
              onClick={handleGoalsNext}
            >
              {goalsCreating ? "Creating goals..." : "Continue"}
            </button>
            <button className="onboardingSkip" onClick={handleSkipOnboarding}>
              Skip onboarding
            </button>
          </div>
        )}

        {/* Step 2: Schedule DNA */}
        {step === 2 && (
          <div className="onboardingStep" key="schedule">
            <h1 className="onboardingTitle">Your schedule DNA</h1>
            <p className="onboardingSubtitle">When do you work and when are you at your sharpest?</p>

            <div className="onboardingTimeRow">
              <div className="onboardingTimeField">
                <label className="inputLabel">Workday starts</label>
                <input
                  className="textInput"
                  type="time"
                  value={workdayStart}
                  onChange={(e) => setWorkdayStart(e.target.value)}
                />
              </div>
              <div className="onboardingTimeField">
                <label className="inputLabel">Workday ends</label>
                <input
                  className="textInput"
                  type="time"
                  value={workdayEnd}
                  onChange={(e) => setWorkdayEnd(e.target.value)}
                />
              </div>
            </div>

            <p className="onboardingEnergyLabel">When are you most energized?</p>
            <div className="onboardingCards onboardingEnergyCards">
              {ENERGY_OPTIONS.map((item) => (
                <button
                  key={item.id}
                  className={`onboardingCard ${peakEnergy === item.id ? "selected" : ""}`}
                  onClick={() => setPeakEnergy(item.id)}
                >
                  <span className="onboardingCardEmoji">{item.emoji}</span>
                  <strong>{item.label}</strong>
                  <span className="onboardingCardDesc">{item.desc}</span>
                </button>
              ))}
            </div>

            <button className="primaryButton" disabled={!peakEnergy} onClick={handleScheduleNext}>
              Continue
            </button>
            <button className="onboardingSkip" onClick={handleSkipOnboarding}>
              Skip onboarding
            </button>
          </div>
        )}

        {/* Step 3: Google Calendar */}
        {step === 3 && (
          <div className="onboardingStep" key="calendar">
            <h1 className="onboardingTitle">Connect your calendar</h1>
            <p className="onboardingSubtitle">
              We'll find open slots and schedule tasks around your meetings.
            </p>

            <div className="onboardingCalendarCard cardShell">
              {gcalConnected ? (
                <div className="onboardingCalendarConnected">
                  <span className="onboardingCheckmark">✓</span>
                  <span>Google Calendar connected</span>
                </div>
              ) : (
                <button className="primaryButton" onClick={handleConnectCalendar}>
                  Connect Google Calendar
                </button>
              )}
            </div>

            <button className="primaryButton" onClick={() => setStep(4)}>
              {gcalConnected ? "Continue" : "Skip for now"}
            </button>
            <button className="onboardingSkip" onClick={handleSkipOnboarding}>
              Skip onboarding
            </button>
          </div>
        )}

        {/* Step 4: WhatsApp Setup */}
        {step === 4 && (
          <div className="onboardingStep" key="whatsapp">
            <h1 className="onboardingTitle">Meet your PA on WhatsApp</h1>
            <p className="onboardingSubtitle">
              Your PA will send you morning briefs, nudges, and evening check-ins. Plus, we'll ask a few quick questions to personalize your experience.
            </p>

            <div className="onboardingWhatsAppSetup">
              <label className="inputLabel">Your WhatsApp number</label>
              <input
                className="textInput"
                placeholder="+91 98765 43210"
                value={whatsAppNumber}
                onChange={(e) => setWhatsAppNumber(e.target.value)}
              />
              <p className="subtle" style={{ marginTop: "0.5rem", fontSize: "12px" }}>
                Include country code (e.g. +91 for India, +1 for US)
              </p>

              {agentWhatsAppFrom && whatsAppNumber.trim() && (
                <div style={{ marginTop: "1rem" }}>
                  <p className="subtle">First, tap below to start a chat with your PA:</p>
                  <a
                    href={`https://wa.me/${agentWhatsAppFrom.replace(/[^0-9]/g, "")}?text=Start`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ghostButton mini"
                    style={{ display: "inline-block", textDecoration: "none", marginTop: "0.4rem" }}
                  >
                    Open WhatsApp
                  </a>
                </div>
              )}
            </div>

            <button
              className="primaryButton"
              disabled={!whatsAppNumber.trim() || loading}
              onClick={handleWhatsAppNext}
            >
              {loading ? "Starting..." : "Continue"}
            </button>
            <button className="ghostButton" onClick={() => setStep(6)}>
              Skip for now
            </button>
            <button className="onboardingSkip" onClick={handleSkipOnboarding}>
              Skip onboarding
            </button>
          </div>
        )}

        {/* Step 5: WhatsApp Conversation (waiting) */}
        {step === 5 && (
          <div className="onboardingStep" key="whatsapp-chat">
            <h1 className="onboardingTitle">Your PA is chatting with you</h1>
            <p className="onboardingSubtitle">
              Check WhatsApp — answer 5 quick questions so your PA can understand you better.
            </p>

            <div className="onboardingWaiting">
              <div className="onboardingPulse" />
              <p>Waiting for you to finish on WhatsApp...</p>
            </div>

            {whatsAppTimedOut && (
              <div className="onboardingTimeoutHint">
                <p>Haven't received a message? Make sure you sent "Start" to the PA's number on WhatsApp.</p>
                <button
                  className="ghostButton mini"
                  onClick={async () => {
                    pollStartRef.current = Date.now();
                    await apiCall("/api/agent/settings", { action: "start_whatsapp" });
                  }}
                >
                  Resend intro message
                </button>
              </div>
            )}

            <button className="ghostButton" onClick={() => setStep(6)} style={{ marginTop: "2rem" }}>
              Skip and continue
            </button>
          </div>
        )}

        {/* Step 6: Your First Day */}
        {step === 6 && (
          <div className="onboardingStep" key="first-day">
            <h1 className="onboardingTitle">Your first day</h1>
            <p className="onboardingSubtitle">
              Here's what your PA has planned for you today.
            </p>

            {loading ? (
              <div className="onboardingWaiting">
                <div className="onboardingPulse" />
                <p>Generating your schedule...</p>
              </div>
            ) : firstDayPlan ? (
              <div className="onboardingFirstDay">
                {firstDayPlan.calendarEvents?.length > 0 && (
                  <div className="onboardingDaySection">
                    <h3>Calendar</h3>
                    {firstDayPlan.calendarEvents.map((e, i) => (
                      <div key={i} className="onboardingTimeBlock onboardingCalEvent">
                        <span className="onboardingBlockTime">{e.time}</span>
                        <span>{e.title}</span>
                      </div>
                    ))}
                  </div>
                )}

                {firstDayPlan.topPriorities?.length > 0 && (
                  <div className="onboardingDaySection">
                    <h3>Top priorities</h3>
                    {firstDayPlan.topPriorities.map((t, i) => (
                      <div key={i} className="onboardingTimeBlock onboardingTaskBlock">
                        <span className="onboardingBlockBadge">{t.estimatedMinutes}m</span>
                        <div>
                          <strong>{t.title}</strong>
                          {t.goalTitle && <span className="onboardingGoalTag">{t.goalTitle}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!firstDayPlan.topPriorities?.length && !firstDayPlan.calendarEvents?.length && (
                  <div className="onboardingEmptyPlan cardShell">
                    <p>Your goals are being decomposed into tasks. Check back in a minute, or jump straight in!</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="onboardingEmptyPlan cardShell">
                <p>Your schedule will be ready soon. Let's get started!</p>
              </div>
            )}

            <button className="primaryButton" onClick={handleFinish}>
              Let's go
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
