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

/* ─── WhatsApp Demo ─── */
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
          You have a clear slot from 9–11 AM.
          <br />
          Start with the pitch deck?
        </>
      ),
      time: "8:00 AM",
    },
    {
      type: "user",
      content: "Done with pitch deck ✓",
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
        "Moved. You completed 2 of 3 today — that's ahead of your weekly average.",
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
        <div className="navLinks">
          <a className="navLink" href="#how">How it works</a>
          <a className="navLink" href="#demo">Demo</a>
        </div>
        <a className="navCta" href="/app">Sign in</a>
      </nav>

      {/* ─── Hero ─── */}
      <section className="landingHero">
        <div className="heroInner">
          <div className="heroText">
            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.05, ease: EASE }}
            >
              The daily planner
              <br />
              that lives in
              <br />
              WhatsApp.
            </motion.h1>

            <motion.p
              className="heroSub"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2, ease: EASE }}
            >
              Text your tasks. Get a plan every morning.
              <br />
              Reply to execute. AI handles the rest.
            </motion.p>

            <motion.div
              className="heroCtas"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.35, ease: EASE }}
            >
              <a className="heroBtn" href="/app">
                Get started — it's free
              </a>
            </motion.div>
          </div>

          <motion.div
            className="heroPhone"
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.9, delay: 0.3, ease: EASE }}
          >
            <WhatsAppDemo />
          </motion.div>
        </div>
      </section>

      {/* ─── Divider ─── */}
      <div className="sectionDivider" />

      {/* ─── How it works (editorial, not cards) ─── */}
      <section className="landingHow" id="how">
        <Reveal>
          <h2>
            You text. It plans.<br />You reply. It adapts.
          </h2>
        </Reveal>

        <div className="howSteps">
          <Reveal delay={0.08}>
            <div className="howStep">
              <div className="howNum">1</div>
              <div className="howBody">
                <h3>Dump your tasks in plain English</h3>
                <p>
                  "Finish pitch deck by Friday." "Call investor after lunch."
                  The AI parses everything — deadlines, priorities, even
                  compound tasks.
                </p>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.16}>
            <div className="howStep">
              <div className="howNum">2</div>
              <div className="howBody">
                <h3>Wake up to a plan that respects your calendar</h3>
                <p>
                  Every morning, get a prioritized daily plan built around your
                  meetings, energy, and deadlines. Not a rigid schedule — a
                  realistic one.
                </p>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.24}>
            <div className="howStep">
              <div className="howNum">3</div>
              <div className="howBody">
                <h3>Execute through the chat you already use</h3>
                <p>
                  Reply "done" to complete tasks. Get a nudge when you're
                  drifting. The agent learns your patterns and adjusts over
                  time.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── Product showcase ─── */}
      <section className="landingShowcase" id="demo">
        <Reveal>
          <h2>
            This is what getting<br />things done looks like.
          </h2>
        </Reveal>
        <Reveal delay={0.1} className="showcasePhone">
          <WhatsAppDemo />
        </Reveal>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="landingCta">
        <Reveal>
          <h2>
            Start with your current list.
            <br />
            Text your first task.
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <a className="ctaBtn" href="/app">
            Get started — it's free
          </a>
        </Reveal>
      </section>

      {/* ─── Footer ─── */}
      <footer className="landingFooter">
        <div className="footerInner">
          <span className="footerBrand">365 Tasks</span>
          <div className="footerLinks">
            <a href="#how">How it works</a>
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
