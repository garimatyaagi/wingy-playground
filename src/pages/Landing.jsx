import { useEffect, useRef, useState } from "react";

/* ─── Scroll-triggered reveal hook ─── */
function useReveal(delay = 0) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (delay) el.style.transitionDelay = `${delay}ms`;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("revealed");
          obs.unobserve(el);
        }
      },
      { threshold: 0.12 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [delay]);
  return ref;
}

/* ─── Animated counter ─── */
function Counter({ end, duration = 2000, suffix = "" }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const startTime = performance.now();
          function step(now) {
            const progress = Math.min((now - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.round(eased * end));
            if (progress < 1) requestAnimationFrame(step);
          }
          requestAnimationFrame(step);
          obs.unobserve(el);
        }
      },
      { threshold: 0.5 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [end, duration]);

  return <span ref={ref}>{count}{suffix}</span>;
}

/* ─── Typing animation for demo ─── */
function TypingDemo({ lines, cycleDuration = 3000 }) {
  const [lineIndex, setLineIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [phase, setPhase] = useState("typing"); // typing | pausing | clearing

  useEffect(() => {
    const currentLine = lines[lineIndex];
    if (phase === "typing") {
      if (charIndex < currentLine.length) {
        const timer = setTimeout(() => setCharIndex((c) => c + 1), 45);
        return () => clearTimeout(timer);
      }
      const timer = setTimeout(() => setPhase("pausing"), 1600);
      return () => clearTimeout(timer);
    }
    if (phase === "pausing") {
      const timer = setTimeout(() => setPhase("clearing"), 200);
      return () => clearTimeout(timer);
    }
    if (phase === "clearing") {
      if (charIndex > 0) {
        const timer = setTimeout(() => setCharIndex((c) => c - 1), 20);
        return () => clearTimeout(timer);
      }
      setLineIndex((i) => (i + 1) % lines.length);
      setPhase("typing");
    }
  }, [phase, charIndex, lineIndex, lines]);

  return (
    <span className="landingTypingText">
      {lines[lineIndex].slice(0, charIndex)}
      <span className="landingCursor" />
    </span>
  );
}

/* ─── WhatsApp demo conversation ─── */
function WhatsAppDemo() {
  const r1 = useReveal(200);
  const r2 = useReveal(600);
  const r3 = useReveal(1000);
  const r4 = useReveal(1400);
  const r5 = useReveal(1800);

  return (
    <div className="landingPhoneMockup">
      <div className="landingPhoneNotch" />
      <div className="landingPhoneHeader">
        <div className="landingPhoneAvatar">365</div>
        <div>
          <div className="landingPhoneName">365 Tasks Agent</div>
          <div className="landingPhoneStatus">online</div>
        </div>
      </div>
      <div className="landingPhoneChat">
        <div className="landingChatBubble agent reveal" ref={r1}>
          <strong>Morning Brief</strong><br />
          Your 3 priorities today:<br />
          1. Finish pitch deck (45 min)<br />
          2. Review PRD with Neha (30 min)<br />
          3. Ship landing page (60 min)
          <span className="landingChatTime">8:00 AM</span>
        </div>
        <div className="landingChatBubble user reveal" ref={r2}>
          Done with pitch deck
          <span className="landingChatTime">10:23 AM</span>
        </div>
        <div className="landingChatBubble agent reveal" ref={r3}>
          Marked "Finish pitch deck" as done. Next up: Review PRD with Neha.
          <span className="landingChatTime">10:23 AM</span>
        </div>
        <div className="landingChatBubble agent reveal" ref={r4}>
          <strong>Nudge</strong><br />
          You have a 1:1 with Neha at 2 PM. Want to review the PRD before that?
          <span className="landingChatTime">12:30 PM</span>
        </div>
        <div className="landingChatBubble user reveal" ref={r5}>
          Push landing page to tomorrow
          <span className="landingChatTime">5:15 PM</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Horizontal scrolling logos ─── */
function LogoStrip() {
  const items = ["WhatsApp", "Google Calendar", "OpenAI", "Supabase", "Vercel", "Twilio"];
  return (
    <div className="landingLogoStrip">
      <div className="landingLogoTrack">
        {[...items, ...items].map((name, i) => (
          <span key={i} className="landingLogoItem">{name}</span>
        ))}
      </div>
    </div>
  );
}

/* ─── Main landing page ─── */
export default function Landing() {
  const heroRef = useReveal();
  const feat1 = useReveal(0);
  const feat2 = useReveal(150);
  const feat3 = useReveal(300);
  const feat4 = useReveal(450);
  const howRef1 = useReveal(0);
  const howRef2 = useReveal(200);
  const howRef3 = useReveal(400);
  const demoRef = useReveal();
  const statsRef = useReveal();
  const ctaRef = useReveal();

  return (
    <div className="landingRoot">
      {/* ─── Nav ─── */}
      <nav className="landingNav">
        <a className="landingLogo" href="/">365 Tasks</a>
        <div className="landingNavLinks">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#demo">Demo</a>
        </div>
        <a className="landingSignIn" href="/app">Sign in</a>
      </nav>

      {/* ─── Ambient glow ─── */}
      <div className="landingGlow" />
      <div className="landingGlow2" />

      {/* ─── Hero ─── */}
      <section className="landingHero reveal" ref={heroRef}>
        <div className="landingHeroBadge">AI-Powered Execution System</div>
        <h1>
          Stop planning.<br />
          <span className="landingHeroAccent">Start finishing.</span>
        </h1>
        <p className="landingHeroSub">
          365 Tasks turns your scattered to-dos into a focused daily system.
          AI plans your day, WhatsApp keeps you accountable, and your calendar stays in sync.
        </p>
        <div className="landingHeroActions">
          <a className="landingHeroCta" href="/app">
            Get started free
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </a>
          <a className="landingHeroCtaSecondary" href="#demo">See it in action</a>
        </div>
        <div className="landingHeroTyping">
          <span className="landingHeroTypingLabel">Try saying:</span>
          <TypingDemo
            lines={[
              "Finish pitch deck by Friday",
              "Review PRD with Neha at 2pm",
              "Ship landing page and email investors",
              "Done with the pitch deck",
              "Push standup notes to tomorrow",
            ]}
          />
        </div>
      </section>

      {/* ─── Logo strip ─── */}
      <LogoStrip />

      {/* ─── Features ─── */}
      <section className="landingSection" id="features">
        <div className="landingSectionHeader reveal" ref={useReveal()}>
          <span className="landingSectionLabel">Features</span>
          <h2>Everything you need to<br />execute consistently</h2>
          <p>A complete system that combines AI planning, WhatsApp messaging, and calendar intelligence into one cohesive workflow.</p>
        </div>

        <div className="landingFeaturesGrid">
          <article className="landingFeatureCard reveal" ref={feat1}>
            <div className="landingFeatureIcon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            <h3>AI Daily Planner</h3>
            <p>Paste your tasks in plain language. AI clusters them into goals and builds a realistic daily plan weighted by urgency, importance, and effort.</p>
          </article>
          <article className="landingFeatureCard reveal" ref={feat2}>
            <div className="landingFeatureIcon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            </div>
            <h3>WhatsApp Execution</h3>
            <p>Morning briefs, midday nudges, afternoon follow-ups, and evening check-ins delivered straight to WhatsApp. Reply to complete, reschedule, or add tasks.</p>
          </article>
          <article className="landingFeatureCard reveal" ref={feat3}>
            <div className="landingFeatureIcon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <h3>Calendar Aware</h3>
            <p>Connects to Google Calendar so your plan respects meetings, deep-work blocks, and free time. No double-booking your attention.</p>
          </article>
          <article className="landingFeatureCard reveal" ref={feat4}>
            <div className="landingFeatureIcon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <h3>Behavioral Intelligence</h3>
            <p>Detects avoidance patterns, admin drift, and deep-work dodging. Adjusts nudge intensity and plan scope based on your actual behavior.</p>
          </article>
        </div>
      </section>

      {/* ─── How it works ─── */}
      <section className="landingSection landingSectionAlt" id="how-it-works">
        <div className="landingSectionHeader reveal" ref={useReveal()}>
          <span className="landingSectionLabel">How it works</span>
          <h2>Three steps to execution mode</h2>
          <p>Go from overwhelmed to in-control in under 2 minutes.</p>
        </div>

        <div className="landingStepsGrid">
          <div className="landingStep reveal" ref={howRef1}>
            <div className="landingStepNumber">01</div>
            <h3>Dump your tasks</h3>
            <p>Text your tasks to WhatsApp in plain English. "Finish pitch deck by Friday", "Call investor after lunch", "Ship v2 and email the team". The AI parses everything — even compound tasks.</p>
          </div>
          <div className="landingStepConnector" />
          <div className="landingStep reveal" ref={howRef2}>
            <div className="landingStepNumber">02</div>
            <h3>AI builds your plan</h3>
            <p>Every morning, get a prioritized daily plan based on urgency, importance, deadlines, calendar gaps, and your actual completion patterns. No manual scheduling required.</p>
          </div>
          <div className="landingStepConnector" />
          <div className="landingStep reveal" ref={howRef3}>
            <div className="landingStepNumber">03</div>
            <h3>Execute via WhatsApp</h3>
            <p>Reply "done" to complete tasks. Get midday nudges when you're drifting. Evening check-ins to reflect. The agent learns your patterns and adapts its approach.</p>
          </div>
        </div>
      </section>

      {/* ─── Demo section ─── */}
      <section className="landingSection" id="demo">
        <div className="landingSectionHeader reveal" ref={useReveal()}>
          <span className="landingSectionLabel">Live demo</span>
          <h2>Your day on WhatsApp</h2>
          <p>This is what a typical day looks like with your AI execution agent.</p>
        </div>

        <div className="landingDemoRow reveal" ref={demoRef}>
          <div className="landingDemoLeft">
            <WhatsAppDemo />
          </div>
          <div className="landingDemoRight">
            <div className="landingDemoFeature">
              <div className="landingDemoFeatureDot" />
              <div>
                <h4>Morning brief at 8 AM</h4>
                <p>Your top 3 priorities for the day, weighted by urgency and calendar availability.</p>
              </div>
            </div>
            <div className="landingDemoFeature">
              <div className="landingDemoFeatureDot" />
              <div>
                <h4>Natural language completion</h4>
                <p>Just say "done" or "finished the deck" — the agent matches it to the right task automatically.</p>
              </div>
            </div>
            <div className="landingDemoFeature">
              <div className="landingDemoFeatureDot" />
              <div>
                <h4>Calendar-aware nudges</h4>
                <p>Knows your schedule. Suggests tackling tasks before upcoming meetings.</p>
              </div>
            </div>
            <div className="landingDemoFeature">
              <div className="landingDemoFeatureDot" />
              <div>
                <h4>Smart rescheduling</h4>
                <p>Say "push to tomorrow" and it reschedules without guilt-tripping — unless you've been avoiding it.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Stats ─── */}
      <section className="landingSection landingSectionAlt">
        <div className="landingStatsGrid reveal" ref={statsRef}>
          <div className="landingStat">
            <div className="landingStatNumber"><Counter end={4} suffix="x" /></div>
            <div className="landingStatLabel">More tasks completed daily</div>
          </div>
          <div className="landingStat">
            <div className="landingStatNumber"><Counter end={87} suffix="%" /></div>
            <div className="landingStatLabel">Reduction in task avoidance</div>
          </div>
          <div className="landingStat">
            <div className="landingStatNumber"><Counter end={2} suffix=" min" /></div>
            <div className="landingStatLabel">Setup time to get started</div>
          </div>
          <div className="landingStat">
            <div className="landingStatNumber"><Counter end={365} /></div>
            <div className="landingStatLabel">Days of momentum ahead</div>
          </div>
        </div>
      </section>

      {/* ─── Bottom CTA ─── */}
      <section className="landingFinalCta reveal" ref={ctaRef}>
        <div className="landingFinalCtaGlow" />
        <h2>Build your year,<br />one intentional day at a time.</h2>
        <p>Start with your current list. Text your first task. The agent handles the rest.</p>
        <a className="landingHeroCta" href="/app">
          Get started free
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </a>
      </section>

      {/* ─── Footer ─── */}
      <footer className="landingFooter">
        <div className="landingFooterInner">
          <div className="landingFooterBrand">
            <a className="landingLogo" href="/">365 Tasks</a>
            <p>AI-powered execution system for people who ship.</p>
          </div>
          <div className="landingFooterLinks">
            <div className="landingFooterCol">
              <h4>Product</h4>
              <a href="#features">Features</a>
              <a href="#how-it-works">How it works</a>
              <a href="#demo">Demo</a>
            </div>
            <div className="landingFooterCol">
              <h4>Legal</h4>
              <a href="#">Privacy</a>
              <a href="#">Terms</a>
            </div>
          </div>
        </div>
        <div className="landingFooterBottom">
          <span>&copy; 2025 365 Tasks. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
