import Link from 'next/link';

export default function Hero() {
  return (
    <section className="reference-hero">
      <div className="reference-hero-image" role="img" aria-label="Creative team working together" />
      <div className="reference-hero-copy">
        <p className="reference-eyebrow">Independent thinking. Digital impact.</p>
        <h1>Build the next.<br />Not the same.</h1>
      </div>
      <div className="reference-hero-services" aria-label="Webgenixx services">
        <div><span>01</span><h2>Design</h2><p>UI/UX + digital experiences</p></div>
        <div><span>02</span><h2>Build</h2><p>Web + mobile + SaaS</p></div>
        <div><span>03</span><h2>Evolve</h2><p>AI + automation + cloud</p></div>
        <Link href="/get-started">Let&apos;s talk <span>↗</span></Link>
      </div>
    </section>
  );
}
