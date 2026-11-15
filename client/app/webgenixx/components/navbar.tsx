import Link from 'next/link';

export default function Navbar() {
  return (
    <nav className="reference-nav">
      <Link className="reference-logo" href="/" style={{ color: '#FFFFFF', fontWeight: 'bold' }}><span style={{ fontWeight: 'bold' }}>webgenixx</span><b>®</b></Link>
      <div className="reference-nav-links">
        <Link style={{ color: '#FFFFFF',fontSize: '15px' }} href="/">Home</Link>
        <Link style={{ color: '#FFFFFF',fontSize: '15px' }} href="/services">Services</Link>
      </div>
      <Link className="reference-nav-cta" style={{ fontSize: '15px' }} href="/get-started">Let&apos;s talk</Link>
    </nav>
  );
}
