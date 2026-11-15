import Link from 'next/link';

export default function WeAreWebgenixx() {
  return (
    <section className="reference-about" id="about">
      <div className="reference-label">We are Webgenixx.</div>
      <div>
        <h2 style={{ fontSize: '32px'}}>Creative thinking.<br />Quality engineering.<br /><em>One shared ambition.</em></h2>
        <p>We bring strategy, design, and technology together to turn business ideas into digital products that look distinctive, work beautifully, and create real momentum.</p>
        <Link className="reference-arrow-link" href="/get-started">Let&apos;s talk <span>↗</span></Link>
      </div>
    </section>
  );
}
