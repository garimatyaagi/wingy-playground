export default function Landing() {
  return (
    <div className="landingRoot">
      <div className="landingGlow" />
      <main className="landingMain">
        <header className="landingHero card">
          <div className="landingBadge">365 Tasks</div>
          <h1>One meaningful task per day. Full-year momentum.</h1>
          <p>
            365 Tasks turns your scattered to-dos into an AI-optimized daily system. Paste tasks,
            import your calendar, and execute one focused task each day.
          </p>
          <div className="landingCtaRow">
            <a className="button landingCtaPrimary" href="/app">
              Get started
            </a>
            <a className="buttonLight landingCtaSecondary" href="#how-it-works">
              See demo
            </a>
          </div>
        </header>

        <section className="landingSection card">
          <div className="landingSectionTitle">Smart Performance</div>
          <div className="perfGrid">
            <article className="perfCard">
              <span>Streak</span>
              <strong>19 days</strong>
            </article>
            <article className="perfCard">
              <span>Tasks Completed</span>
              <strong>74 / 365</strong>
            </article>
            <article className="perfCard">
              <span>Today Focus Score</span>
              <strong>86%</strong>
            </article>
            <article className="perfCard perfWide">
              <span>Year Progress</span>
              <strong>74/365</strong>
              <div className="perfBar">
                <i style={{ width: "20%" }} />
              </div>
            </article>
          </div>
          <div className="insightChips">
            <span>Over-scheduled Thursday</span>
            <span>Best deep-work window: 10:00-12:00</span>
            <span>Momentum strongest after morning review</span>
          </div>
        </section>

        <section id="how-it-works" className="landingSection card">
          <div className="landingSectionTitle">How It Works</div>
          <div className="flowRow">
            <article className="flowStep">
              <h3>Input</h3>
              <p>Paste tasks and import your calendar.</p>
            </article>
            <article className="flowStep">
              <h3>AI Planner</h3>
              <p>Clusters tasks into goals, sub-goals, and realistic time blocks.</p>
            </article>
            <article className="flowStep">
              <h3>Output</h3>
              <p>Daily plan with nudges, priority shifts, and execution prompts.</p>
            </article>
          </div>
        </section>

        <section className="landingSplit">
          <article className="card landingPanel">
            <div className="landingSectionTitle">Paste Tasks to Organized Goal Tree</div>
            <div className="mockSplit">
              <div className="mockBox">
                <div className="mockLabel">Raw task dump</div>
                <pre>{`- renew passport
- finalize sales deck
- run 3x weekly workouts
- prepare tax docs`}</pre>
              </div>
              <div className="mockBox">
                <div className="mockLabel">AI structured output</div>
                <ul>
                  <li>
                    <strong>Goal A: Life Admin</strong>
                    <span>Sub-goal: Passport renewal</span>
                  </li>
                  <li>
                    <strong>Goal B: Career</strong>
                    <span>Sub-goal: Sales deck + review</span>
                  </li>
                  <li>
                    <strong>Goal C: Health</strong>
                    <span>Sub-goal: 3-session weekly plan</span>
                  </li>
                </ul>
              </div>
            </div>
          </article>

          <article className="card landingPanel">
            <div className="landingSectionTitle">Calendar-Aware Optimization</div>
            <div className="timelineMock">
              <div>
                <span>08:00</span>
                <i />
                <p>Light admin</p>
              </div>
              <div className="active">
                <span>10:00</span>
                <i />
                <p>Deep work task of the day</p>
              </div>
              <div>
                <span>14:30</span>
                <i />
                <p>Meetings + shallow follow-ups</p>
              </div>
              <div>
                <span>18:00</span>
                <i />
                <p>Nudge: close one pending item</p>
              </div>
            </div>
          </article>
        </section>

        <section className="landingCta card">
          <h2>Build your year one intentional day at a time.</h2>
          <p>Start with your current list. 365 Tasks handles structure, sequencing, and nudges.</p>
          <div className="landingCtaRow">
            <a className="button landingCtaPrimary" href="/app">
              Get started
            </a>
            <a className="buttonLight landingCtaSecondary" href="#how-it-works">
              See demo
            </a>
          </div>
        </section>

        <footer className="landingFooter">
          <a href="/app">App</a>
          <a href="#how-it-works">How it works</a>
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
        </footer>
      </main>
    </div>
  );
}
