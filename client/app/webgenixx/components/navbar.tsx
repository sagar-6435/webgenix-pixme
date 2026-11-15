'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="reference-nav">
      <Link
        className="reference-logo"
        href="/"
        style={{ color: '#FFFFFF', fontWeight: 'bold' }}
        onClick={() => setIsOpen(false)}
      >
        <span style={{ fontWeight: 'bold' }}>webgenixx</span>
        <b>®</b>
      </Link>

      <div className="reference-nav-links">
        <Link style={{ color: '#FFFFFF', fontSize: '15px' }} href="/">
          Home
        </Link>
        <Link style={{ color: '#FFFFFF', fontSize: '15px' }} href="/services">
          Services
        </Link>
      </div>

      <div className="reference-nav-actions">
        <Link
          className="reference-nav-cta"
          style={{ fontSize: '15px' }}
          href="/get-started"
          onClick={() => setIsOpen(false)}
        >
          Let&apos;s talk
        </Link>

        <button
          type="button"
          className={`reference-menu-btn ${isOpen ? 'active' : ''}`}
          onClick={() => setIsOpen(!isOpen)}
          aria-label={isOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={isOpen}
        >
          <span className="reference-menu-icon">
            <span className="line line-1" />
            <span className="line line-2" />
            <span className="line line-3" />
          </span>
          <span className="reference-menu-text">{isOpen ? 'Close' : 'Menu'}</span>
        </button>
      </div>

      {isOpen && (
        <div className="reference-mobile-menu">
          <div className="reference-mobile-links">
            <Link href="/" onClick={() => setIsOpen(false)}>
              Home
            </Link>
            <Link href="/services" onClick={() => setIsOpen(false)}>
              Services
            </Link>
            <Link
              className="reference-mobile-cta"
              href="/get-started"
              onClick={() => setIsOpen(false)}
            >
              Get Started <span>↗</span>
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
