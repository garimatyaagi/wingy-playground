import { useEffect, useRef } from "react";

function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("revealed");
          obs.unobserve(el);
        }
      },
      { threshold: 0.15 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

export default function Landing() {
  const feat1 = useReveal();
  const feat2 = useReveal();
  const feat3 = useReveal();
  const ctaRef = useReveal();

  return (
    <div className="landingRoot">
      <nav className="landingNav">
        <a className="landingLogo" href="/">365 Tasks</a>
        <a className="landingSignIn" href="/app">Sign in</a>
      </nav>

      <div className="landingGlow" />

      <section className="landingHero">
        <h1>One task a day.<br />A year of momentum.</h1>
        <p>
          Turn scattered to-dos into a focused daily system. AI plans your day,
          WhatsApp keeps you accountable, and your calendar stays in sync.
        </p>
        <a className="landingHeroCta" href="/app">Get started</a>
      </section>

      <section className="landingFeatures">
        <article className="featureCard reveal" ref={feat1}>
          <div className="featureIcon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          </div>
          <h3>AI daily planner</h3>
          <p>Paste your tasks. AI clusters them into goals and builds a realistic daily plan around your calendar.</p>
        </article>
        <article className="featureCard reveal" ref={feat2}>
          <div className="featureIcon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          </div>
          <h3>WhatsApp nudges</h3>
          <p>Morning briefs, midday check-ins, and evening summaries delivered straight to your WhatsApp.</p>
        </article>
        <article className="featureCard reveal" ref={feat3}>
          <div className="featureIcon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <h3>Calendar aware</h3>
          <p>Connects to Google Calendar so your plan respects meetings, deep-work blocks, and free time.</p>
        </article>
      </section>

      <section className="landingBottomCta reveal" ref={ctaRef}>
        <h2>Build your year, one intentional day at a time.</h2>
        <p>Start with your current list. 365 Tasks handles the rest.</p>
        <a className="landingHeroCta" href="/app">Get started</a>
      </section>

      <footer className="landingFooter">
        <a href="/app">App</a>
        <a href="#">Privacy</a>
        <a href="#">Terms</a>
      </footer>
    </div>
  );
}
