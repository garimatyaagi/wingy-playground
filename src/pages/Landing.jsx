import { useEffect, useState } from "react";
import { motion } from "framer-motion";

const EASE = [0.25, 0.1, 0.25, 1];

function Reveal({ children, delay = 0, y = 32, className = "" }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* WhatsApp Demo — shown once in the hero */
function WhatsAppDemo() {
  const bubbles = [
    {
      type: "bot",
      content: (
        <>
          <strong>Good morning! Here's your plan:</strong>
          <br />
          <br />
          1. Finish pitch deck — 45 min
          <br />
          2. Review PRD with Neha — 30 min
          <br />
          3. Ship landing page — 60 min
          <br />
          <br />
          You have a clear slot 9–11 AM.
          <br />
          Start with the pitch deck?
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
      content: "Nice. PRD review is next — Neha's 1:1 is at 2 PM.",
      time: "10:23 AM",
    },
    {
      type: "user",
      content: "Push landing page to tomorrow",
      time: "5:15 PM",
    },
    {
      type: "bot",
      content:
        "Moved. You finished 2 of 3 today — ahead of your weekly average.",
      time: "5:15 PM",
    },
  ];

  return (
    <div className="phoneMockup">
      <div className="phoneScreen">
        <div className="waHeader">
          <div className="waAvatar">365</div>
          <div className="waHeaderText">
            <h4>365 Tasks</h4>
            <span>online</span>
          </div>
        </div>
        <div className="waChat">
          {bubbles.map((b, i) => (
            <motion.div
              key={i}
              className={`waBubble ${b.type}`}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-20px" }}
              transition={{ duration: 0.5, delay: i * 0.15, ease: EASE }}
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

/* ═══════════════════════════════════════════ */
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
        <a className="navLogo" href="/">365 Tasks</a>
        <a className="navCta" href="/app">Get started</a>
      </nav>

      {/* ─── Hero ─── */}
      <section className="landingHero">
        <div className="noiseOverlay" />
        <div className="heroInner">
          <div className="heroText">
            <motion.p
              className="heroLabel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0, ease: EASE }}
            >
              001 — WhatsApp-native planner
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1, ease: EASE }}
            >
              Your daily plan,
              <br />
              inside WhatsApp.
            </motion.h1>

            <motion.p
              className="heroSub"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.25, ease: EASE }}
            >
              Text your tasks. Wake up to a plan. Reply to execute.
            </motion.p>

            <motion.a
              className="heroBtn"
              href="/app"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4, ease: EASE }}
            >
              Get started — it's free
            </motion.a>
          </div>

          <motion.div
            className="heroPhone"
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.9, delay: 0.35, ease: EASE }}
          >
            <WhatsAppDemo />
          </motion.div>
        </div>
      </section>

      {/* ─── Statements ─── */}
      <section className="landingStatements">
        <div className="noiseOverlay" />
        <div className="statementsInner">
          <Reveal>
            <div className="statement">
              <p className="statementLabel">001</p>
              <h2 className="statementHeading">
                Dump tasks in plain English.
              </h2>
              <p className="statementBody">
                No forms, no fields. Just text what needs to happen.
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.05}>
            <div className="statement">
              <p className="statementLabel">002</p>
              <h2 className="statementHeading">
                Wake up to a realistic plan.
              </h2>
              <p className="statementBody">
                Built around your calendar, energy, and deadlines.
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="statement">
              <p className="statementLabel">003</p>
              <h2 className="statementHeading">
                Reply to execute. It adapts.
              </h2>
              <p className="statementBody">
                The agent learns your patterns and adjusts over time.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="landingCta">
        <div className="noiseOverlay" />
        <Reveal>
          <h2>
            Text your first task.
            <br />
            Start right now.
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <a className="ctaBtn" href="/app">Get started — it's free</a>
        </Reveal>
      </section>

      {/* ─── Footer ─── */}
      <footer className="landingFooter">
        <div className="noiseOverlay" />
        <div className="footerInner">
          <span className="footerBrand">365 Tasks</span>
          <div className="footerLinks">
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
