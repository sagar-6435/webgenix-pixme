 'use client';

import { useEffect, useRef } from 'react';

const process = [
  ['01', 'Discover', 'We immerse in your business, market and ambition.'],
  ['02', 'Research', 'Data, audience and competitor intelligence inform every move.'],
  ['03', 'Design', 'Distinctive systems crafted with obsessive detail.'],
  ['04', 'Build', 'Engineering that is fast, scalable and resilient.'],
  ['05', 'Optimize', 'Continuous iteration toward compounding growth.'],
];

export default function HowWeWork() {
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;

    const steps = Array.from(timeline.children);
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle('is-visible', entry.isIntersecting);
        });
      },
      { threshold: 0.2, rootMargin: '0px 0px -10% 0px' },
    );

    steps.forEach((step) => observer.observe(step));
    return () => observer.disconnect();
  }, []);

  return (
    <section className="reference-process" id="process">
      <p className="reference-eyebrow">How we work</p>
      <h2>webgenixx</h2>
      <div className="reference-process-list" ref={timelineRef}>
        {process.map(([number, title, copy]) => (
          <div key={number}>
            <span>{number}</span>
            <div>
              <h3>{title}</h3>
              <p>{copy}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
