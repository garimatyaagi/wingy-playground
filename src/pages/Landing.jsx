import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";

/* ─── Motion constants ─── */
const EASE = [0.25, 0.1, 0.25, 1];

/* ─── Reusable Reveal wrapper ─── */
function Reveal({ children, delay = 0, y = 40, className = "" }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.8, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ─── Stagger variants ─── */
const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.15 } },
};
const staggerItem = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: EASE },
  },
};

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

  return (
    <span ref={ref}>
      {count}
      {suffix}
    </span>
  );
}

/* ─── Typing animation for hero input bar ─── */
function TypingDemo({ lines }) {
  const [lineIndex, setLineIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [phase, setPhase] = useState("typing");

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
    <>
      {lines[lineIndex].slice(0, charIndex)}
      <span className="typingCursor" />
    </>
  );
}

/* ─── WhatsApp Demo (centered phone) ─── */
function WhatsAppDemo() {
  const bubbles = [
    {
      type: "bot",
      content: (
        <>
          <strong>Morning Brief</strong>
          <br />
          Your 3 priorities today:
          <br />
          1. Finish pitch deck (45 min)
          <br />
          2. Review PRD with Neha (30 min)
          <br />
          3. Ship landing page (60 min)
        </>
      ),
      time: "8:00 AM",
    },
    {
      type: "user",
      content: "Done with pitch deck",
      time: "10:23 AM",
    },
    {
      type: "bot",
      content:
        'Marked "Finish pitch deck" as done. Next up: Review PRD with Neha.',
      time: "10:23 AM",
    },
    {
      type: "bot",
      content: (
        <>
          <strong>Nudge</strong>
          <br />
          You have a 1:1 with Neha at 2 PM. Want to review the PRD before that?
        </>
      ),
      time: "12:30 PM",
    },
    {
      type: "user",
      content: "Push landing page to tomorrow",
      time: "5:15 PM",
    },
  ];

  return (
    <div className="phoneMockup">
      <div className="phoneScreen">
        <div className="waHeader">
          <div className="waAvatar">365</div>
          <div className="waHeaderText">
            <h4>365 Tasks Agent</h4>
            <span>online</span>
          </div>
        </div>
        <div className="waChat">
          {bubbles.map((b, i) => (
            <motion.div
              key={i}
              className={`waBubble ${b.type}`}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.6, delay: i * 0.2, ease: EASE }}
            >
              {b.content}
              <span className="waTime">{b.time}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Logo strip ─── */
function LogoStrip() {
  const items = [
    "WhatsApp",
    "Google Calendar",
    "OpenAI",
    "Supabase",
    "Vercel",
    "Twilio",
  ];
  return (
    <section className="landingSocialProof">
      <Reveal>
        <p className="socialLabel">Powered by</p>
      </Reveal>
      <div className="logoStripTrack">
        <div className="logoStripInner">
          {[...items, ...items].map((name, i) => (
            <span key={i} style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap" }}>
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Feature data ─── */
const FEATURES = [
  {
    label: "Planning",
    title: "AI Daily Planner",
    desc: "Paste your tasks in plain language. AI clusters them into goals and builds a realistic daily plan weighted by urgency, importance, and effort.",
    icon: "📋",
  },
  {
    label: "Execution",
    title: "WhatsApp Execution",
    desc: "Morning briefs, midday nudges, and evening check-ins delivered straight to WhatsApp. Reply to complete, reschedule, or add tasks.",
    icon: "💬",
  },
  {
    label: "Awareness",
    title: "Calendar Aware",
    desc: "Connects to Google Calendar so your plan respects meetings, deep-work blocks, and free time. No double-booking your attention.",
    icon: "📅",
  },
  {
    label: "Intelligence",
    title: "Behavioral Intelligence",
    desc: "Detects avoidance patterns, admin drift, and deep-work dodging. Adjusts nudge intensity and plan scope based on your actual behavior.",
    icon: "🧠",
  },
];

/* ─── How-it-works data ─── */
const STEPS = [
  {
    num: "01",
    title: "Dump your tasks",
    desc: 'Text your tasks to WhatsApp in plain English. "Finish pitch deck by Friday", "Call investor after lunch". The AI parses everything — even compound tasks.',
  },
  {
    num: "02",
    title: "AI builds your plan",
    desc: "Every morning, get a prioritized daily plan based on urgency, importance, deadlines, calendar gaps, and your actual completion patterns.",
  },
  {
    num: "03",
    title: "Execute via WhatsApp",
    desc: 'Reply "done" to complete tasks. Get midday nudges when you\'re drifting. Evening check-ins to reflect. The agent learns your patterns and adapts.',
  },
];

/* ═══════════════════════════════════════════
   Main Landing Page
   ═══════════════════════════════════════════ */
export default function Landing() {
  /* Nav scroll awareness */
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div>
      {/* ─── Nav ─── */}
      <nav className={`landingNav${scrolled ? " scrolled" : ""}`}>
        <a className="navLogo" href="/">
          365 Tasks
        </a>
        <div className="navLinks">
          <a className="navLink" href="#features">
            Features
          </a>
          <a className="navLink" href="#how-it-works">
            How it works
          </a>
          <a className="navLink" href="#demo">
            Demo
          </a>
        </div>
        <a className="primaryButton navCta" href="/app">
          Sign in
        </a>
        <button className="navMobileToggle" aria-label="Menu">
          ☰
        </button>
      </nav>

      {/* ─── Hero ─── */}
      <section className="landingHero">
        <div className="heroGlow" />

        <motion.div
          className="heroBadge"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0, ease: EASE }}
        >
          AI-Powered · <span>Execution System</span>
        </motion.div>

        <motion.h1
          className="heroHeadline"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
        >
          Stop planning.
          <br />
          <span className="accentGradient">Start finishing.</span>
        </motion.h1>

        <motion.p
          className="heroSub"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.35, ease: EASE }}
        >
          365 Tasks turns your scattered to-dos into a focused daily system. AI
          plans your day, WhatsApp keeps you accountable, and your calendar stays
          in sync.
        </motion.p>

        <motion.div
          className="heroCtas"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.5, ease: EASE }}
        >
          <a className="primaryButton" href="/app">
            Get started free →
          </a>
          <a className="ghostButton" href="#demo">
            See it in action
          </a>
        </motion.div>

        <motion.div
          className="heroInputDemo"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.65, ease: EASE }}
        >
          <div className="heroInputText">
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
          <div className="heroSendBtn">▶</div>
        </motion.div>
      </section>

      {/* ─── Social Proof ─── */}
      <LogoStrip />

      {/* ─── Value Proposition ─── */}
      <section className="landingValue">
        <Reveal>
          <h2 className="valueStatement">
            Your AI chief of staff, delivered through WhatsApp.
          </h2>
        </Reveal>

        <motion.div
          className="valueGrid"
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
        >
          {[
            {
              icon: "⚡",
              title: "Instant capture",
              desc: "Text any task in plain language. AI parses multi-part requests, extracts deadlines, and assigns priorities automatically.",
            },
            {
              icon: "🎯",
              title: "Adaptive planning",
              desc: "Your daily plan adjusts based on calendar gaps, energy patterns, and completion history — not rigid schedules.",
            },
            {
              icon: "🔄",
              title: "Accountability loop",
              desc: "Morning briefs, midday nudges, and evening reflections keep you on track without micromanagement.",
            },
          ].map((item, i) => (
            <motion.div className="valueItem" key={i} variants={staggerItem}>
              <div className="valueIcon">{item.icon}</div>
              <h3>{item.title}</h3>
              <p>{item.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ─── Features (alternating rows) ─── */}
      <section className="landingFeatures" id="features">
        {FEATURES.map((feat, i) => (
          <Reveal key={i}>
            <div className={`featureRow${i % 2 === 1 ? " reverse" : ""}`}>
              <div className="featureContent">
                <span className="featureLabel">{feat.label}</span>
                <h3>{feat.title}</h3>
                <p>{feat.desc}</p>
              </div>
              <div className="featureVisual">
                <div className="featureVisualBox">{feat.icon}</div>
              </div>
            </div>
          </Reveal>
        ))}
      </section>

      {/* ─── How It Works (vertical timeline) ─── */}
      <section className="landingHowItWorks" id="how-it-works">
        <Reveal className="howItWorksHeader">
          <h2>Three steps to execution mode</h2>
          <p>
            Go from overwhelmed to in-control in under 2 minutes.
          </p>
        </Reveal>

        <div className="timelineSteps">
          {STEPS.map((step, i) => (
            <Reveal key={i} delay={i * 0.15}>
              <div className="timelineStep">
                <div className="timelineNumber">{step.num}</div>
                <div className="timelineBody">
                  <h3>{step.title}</h3>
                  <p>{step.desc}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ─── Demo (centered phone) ─── */}
      <section className="landingDemo" id="demo">
        <Reveal className="demoHeader">
          <h2>Your day on WhatsApp</h2>
        </Reveal>

        <Reveal className="phoneContainer">
          <WhatsAppDemo />
        </Reveal>

        <Reveal>
          <p className="demoCaption">
            This is what getting things done feels like.
          </p>
        </Reveal>
      </section>

      {/* ─── Stats ─── */}
      <section className="landingStats">
        <div className="landingStatsInner">
          <Reveal>
            <div className="landingStatsGrid">
              <div className="statItem">
                <div className="statNumber">
                  <Counter end={4} suffix="x" />
                </div>
                <div className="statLabel">More tasks completed</div>
              </div>
              <div className="statItem">
                <div className="statNumber">
                  <Counter end={87} suffix="%" />
                </div>
                <div className="statLabel">Less task avoidance</div>
              </div>
              <div className="statItem">
                <div className="statNumber">
                  <Counter end={2} suffix=" min" />
                </div>
                <div className="statLabel">Setup time</div>
              </div>
              <div className="statItem">
                <div className="statNumber">
                  <Counter end={365} />
                </div>
                <div className="statLabel">Days of momentum</div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="landingFinalCta">
        <div className="ctaGlow" />
        <Reveal>
          <h2>
            Build your year,
            <br />
            one intentional day at a time.
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p>
            Start with your current list. Text your first task. The agent
            handles the rest.
          </p>
        </Reveal>
        <Reveal delay={0.3}>
          <a className="primaryButton" href="/app">
            Get started free →
          </a>
        </Reveal>
      </section>

      {/* ─── Footer ─── */}
      <footer className="landingFooter">
        <div className="footerInner">
          <div className="footerBrand">365 Tasks</div>
          <div className="landingFooterLinks">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
            <a href="#demo">Demo</a>
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
          </div>
        </div>
        <p className="footerCopy">
          &copy; 2025 365 Tasks. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
