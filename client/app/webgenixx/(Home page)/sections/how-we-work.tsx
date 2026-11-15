 'use client';

import { useEffect, useRef, useState } from 'react';

const process = [
  ['01', 'Discover', 'We immerse in your business, market and ambition.'],
  ['02', 'Research', 'Data, audience and competitor intelligence inform every move.'],
  ['03', 'Design', 'Distinctive systems crafted with obsessive detail.'],
  ['04', 'Build', 'Engineering that is fast, scalable and resilient.'],
  ['05', 'Optimize', 'Continuous iteration toward compounding growth.'],
];

export default function HowWeWork() {
  const timelineRef = useRef<HTMLDivElement>(null);
  const pointRef = useRef<HTMLDivElement>(null);
  const progressLineRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;

    const steps = Array.from(timeline.querySelectorAll<HTMLElement>('.reference-process-item'));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle('is-visible', entry.isIntersecting);
        });
      },
      { threshold: 0.2, rootMargin: '0px 0px -10% 0px' },
    );

    steps.forEach((step) => observer.observe(step));

    let rafId: number | null = null;

    const updatePointPosition = () => {
      rafId = null;
      if (!timeline || !pointRef.current) return;

      const rect = timeline.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      // Focal reference is centered around 45% of viewport
      const focalY = viewportHeight * 0.45;
      const isMobile = window.innerWidth <= 700;
      const startY = 16;
      const bottomOffset = isMobile ? 60 : 76;
      const totalTrackHeight = Math.max(timeline.clientHeight - startY - bottomOffset, 1);

      const currentScroll = focalY - rect.top;
      const progress = currentScroll / (rect.height - bottomOffset);
      const clamped = Math.min(Math.max(progress, 0), 1);

      const currentY = startY + clamped * totalTrackHeight;

      pointRef.current.style.transform = `translate(-50%, -50%) translateY(${currentY}px)`;

      if (progressLineRef.current) {
        progressLineRef.current.style.height = `${clamped * totalTrackHeight}px`;
      }

      // Determine active step
      let currentActive = 0;
      steps.forEach((step, idx) => {
        const stepRect = step.getBoundingClientRect();
        if (stepRect.top <= focalY + 40) {
          currentActive = idx;
        }
      });
      setActiveIndex(currentActive);
    };

    const handleScroll = () => {
      if (rafId === null) {
        rafId = requestAnimationFrame(updatePointPosition);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });
    updatePointPosition();

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <section className="reference-process" id="process">
      <p className="reference-eyebrow">How we work</p>
      <h2>webgenixx</h2>
      <div className="reference-process-list" ref={timelineRef}>
        {process.map(([number, title, copy], idx) => (
          <div
            key={number}
            className={`reference-process-item ${idx <= activeIndex ? 'is-active' : ''}`}
          >
            <span>{number}</span>
            <div>
              <h3>{title}</h3>
              <p>{copy}</p>
            </div>
          </div>
        ))}
        <div className="reference-process-timeline-rail" aria-hidden="true">
          <div className="reference-process-progress-line" ref={progressLineRef} />
          <div className="reference-process-moving-point" ref={pointRef} />
        </div>
      </div>
    </section>
  );
}
