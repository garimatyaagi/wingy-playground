import { useEffect, useState } from "react";
import { motion } from "framer-motion";

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
          You have a 1:1 with Neha at 2 PM. Want to review the PRD before
          that?
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
      <div className="phoneNotch" />
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

/* ─── Data ─── */
const VALUE_PROPS = [
  {
    title: "Instant capture",
    desc: "Text any task in plain language. AI extracts deadlines and priorities automatically.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
  },
  {
    title: "Adaptive planning",
    desc: "Your daily plan adjusts to calendar gaps, energy patterns, and completion history.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
      </svg>
    ),
  },
  {
    title: "Accountability loop",
    desc: "Morning briefs, midday nudges, and evening reflections. No app to open.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
];

const STEPS = [
  {
    num: "01",
    title: "Text your tasks",
    desc: "Message your tasks to WhatsApp in plain language. The AI parses everything instantly.",
  },
  {
    num: "02",
    title: "Get your daily plan",
    desc: "Each morning, receive a prioritized plan built around your calendar and deadlines.",
  },
  {
    num: "03",
    title: "Execute and adapt",
    desc: "Reply to complete tasks. Get nudges when you drift. The system learns and adjusts.",
  },
];

/* ═══════════════════════════════════════════
   Main Landing Page
   ═══════════════════════════════════════════ */
export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="landingPage">
      {/* ─── Nav ─── */}
      <nav className={`landingNav${scrolled ? " scrolled" : " heroNav"}`}>
        <a className="navLogo" href="/">
          365 Tasks
        </a>
        <div className="navLinks">
          <a className="navLink" href="#how-it-works">
            How it works
          </a>
          <a className="navLink" href="#demo">
            Demo
          </a>
        </div>
        <a className="primaryButton navCta" href="/app">
          Get started
        </a>
        <button className="navMobileToggle" aria-label="Menu">
          ☰
        </button>
      </nav>

      {/* ─── Hero ─── */}
      <section className="landingHero">
        <div className="heroOrb heroOrb1" />
        <div className="heroOrb heroOrb2" />
        <div className="heroNoise" />

        <div className="heroContent">
          <motion.div
            className="heroBadge"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0, ease: EASE }}
          >
            <span className="heroBadgeDot" />
            AI-powered execution
          </motion.div>

          <motion.h1
            className="heroHeadline"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1, ease: EASE }}
          >
            Stop planning.
            <br />
            Start finishing.
          </motion.h1>

          <motion.p
            className="heroSub"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: EASE }}
          >
            365 Tasks turns scattered to-dos into a focused daily system.
            <br />
            AI plans your day, WhatsApp keeps you on track.
          </motion.p>

          <motion.div
            className="heroCtas"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.5, ease: EASE }}
          >
            <a className="heroButton" href="/app">
              Get started free
              <span className="heroButtonArrow">→</span>
            </a>
            <a className="heroGhostButton" href="#demo">
              See demo
            </a>
          </motion.div>
        </div>

        <motion.div
          className="heroVisual"
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.6, ease: EASE }}
        >
          <div className="heroPhoneGlow" />
          <WhatsAppDemo />
        </motion.div>

        <div className="heroFade" />
      </section>

      {/* ─── Value Proposition ─── */}
      <section className="landingValue">
        <div className="sectionOrbLeft" />
        <Reveal>
          <p className="sectionEyebrow">Why 365 Tasks</p>
          <h2 className="sectionHeading">
            Your AI chief of staff,
            <br />
            delivered through WhatsApp.
          </h2>
        </Reveal>

        <motion.div
          className="valueGrid"
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
        >
          {VALUE_PROPS.map((item, i) => (
            <motion.div className="valueCard" key={i} variants={staggerItem}>
              <div className="valueIconBox">{item.icon}</div>
              <h3>{item.title}</h3>
              <p>{item.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ─── How It Works ─── */}
      <section className="landingHowItWorks" id="how-it-works">
        <Reveal>
          <p className="sectionEyebrow">How it works</p>
          <h2 className="sectionHeading">
            Three steps to
            <br />
            execution mode.
          </h2>
        </Reveal>

        <div className="stepsGrid">
          {STEPS.map((step, i) => (
            <Reveal key={i} delay={i * 0.12}>
              <div className="stepCard">
                <div className="stepNumBg">{step.num}</div>
                <span className="stepNum">{step.num}</span>
                <h3>{step.title}</h3>
                <p>{step.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ─── Demo ─── */}
      <section className="landingDemo" id="demo">
        <div className="demoGradient" />
        <div className="demoNoise" />

        <Reveal className="demoHeader">
          <p className="sectionEyebrow sectionEyebrowLight">Live preview</p>
          <h2 className="sectionHeading sectionHeadingLight">
            See it in action
          </h2>
          <p className="demoSubtitle">
            This is what a productive day looks like on WhatsApp.
          </p>
        </Reveal>

        <Reveal className="phoneContainer">
          <div className="demoPhoneGlow" />
          <WhatsAppDemo />
        </Reveal>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="landingFinalCta">
        <div className="ctaOrb ctaOrb1" />
        <div className="ctaOrb ctaOrb2" />
        <Reveal>
          <h2>
            Build your year,
            <br />
            one day at a time.
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="ctaSub">
            Start with your current list. Text your first task.
            <br />
            The agent handles the rest.
          </p>
        </Reveal>
        <Reveal delay={0.2}>
          <a className="ctaButton" href="/app">
            Get started free
            <span className="heroButtonArrow">→</span>
          </a>
        </Reveal>
      </section>

      {/* ─── Footer ─── */}
      <footer className="landingFooter">
        <div className="footerInner">
          <div className="footerBrand">365 Tasks</div>
          <div className="landingFooterLinks">
            <a href="#how-it-works">How it works</a>
            <a href="#demo">Demo</a>
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
          </div>
        </div>
        <div className="footerDivider" />
        <p className="footerCopy">
          &copy; 2025 365 Tasks. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
