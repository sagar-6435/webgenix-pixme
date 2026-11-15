import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="reference-footer">
      <Link className="reference-logo" href="/">web<span>genixx</span><b>®</b></Link>
      <div className="site-footer-links">
        <a href="https://instagram.com/thewebgenixx" target="_blank" rel="noreferrer">Instagram</a>
        <a href="mailto:contact@thewebgenixx.in">Email</a>
        <a href="tel:+918897536435">+91 88975 36435</a>
        <a href="https://linkedin.com/company/webgenixx" target="_blank" rel="noreferrer">LinkedIn</a>
      </div>
      <span>© 2026 Webgenixx</span>
    </footer>
  );
}
