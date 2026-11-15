import Link from 'next/link';

const highlights = [
  ['01', 'Upload once', 'Your gallery is processed in the background while you focus on the event.'],
  ['02', 'Share one scan', 'Guests open a branded event page without creating an account.'],
  ['03', 'Find your moments', 'Consent-based face matching returns a private, personal gallery.'],
];

export default function PixmeHome() {
  return (
    <main>
      <nav className="nav shell">
        <Link className="brand" href="/pixme">pixme<span>.</span></Link>
        <div className="nav-links"><Link href="/scan">Scan an event</Link><Link href="/photographer">For photographers</Link><Link className="button button-small" href="/photographer">Sign in</Link></div>
      </nav>
      <section className="landing-hero shell">
        <div className="eyebrow"><span className="eyebrow-dot" /> Intelligent event galleries</div>
        <h1>Every guest gets<br /><em>their</em> best moments.</h1>
        <p className="lead">Pixme turns thousands of event photographs into a private, beautiful gallery each guest can find in seconds.</p>
        <div className="hero-actions"><Link className="button" href="/scan">Scan an event <span>↗</span></Link><Link className="text-link" href="/photographer">Explore the studio <span>→</span></Link></div>
        <div className="hero-art" aria-hidden="true"><div className="hero-orb orb-one" /><div className="hero-orb orb-two" /><div className="hero-card"><div className="mini-logo">p.</div><div className="mini-line" /><div className="mini-photo photo-a" /><div className="mini-photo photo-b" /><div className="mini-photo photo-c" /><div className="mini-chip">24 moments found</div></div></div>
      </section>
      <section className="shell trust-row"><span>BUILT FOR THE MOMENTS THAT MATTER</span><strong>Weddings</strong><strong>Celebrations</strong><strong>Corporate</strong><strong>Studios</strong></section>
      <section className="shell section">
        <div className="section-heading"><div><div className="eyebrow">How it works</div><h2>Less searching.<br /><em>More reliving.</em></h2></div><p>One simple flow for photographers and guests. No app download, no gallery browsing, no lost memories.</p></div>
        <div className="feature-grid">{highlights.map(([number, title, copy]) => <article className="feature" key={number}><span className="feature-number">{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
      </section>
      <section className="shell cta-banner"><div><div className="eyebrow">Ready when you are</div><h2>Start with a scan.</h2></div><Link className="button button-light" href="/scan">Open QR scanner <span>↗</span></Link></section>
      <footer className="shell footer"><span className="brand">pixme<span>.</span></span><span>Private by design · © 2026 Pixme</span></footer>
    </main>
  );
}
