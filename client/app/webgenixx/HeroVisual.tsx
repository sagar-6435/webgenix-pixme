'use client';

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import type { PointerEvent } from 'react';

export default function HeroVisual() {
  const reduceMotion = useReducedMotion();
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const smoothX = useSpring(pointerX, { stiffness: 90, damping: 22, mass: 0.7 });
  const smoothY = useSpring(pointerY, { stiffness: 90, damping: 22, mass: 0.7 });
  const laptopRotateY = useTransform(smoothX, [-1, 1], [6, -6]);
  const laptopRotateX = useTransform(smoothY, [-1, 1], [-4, 4]);
  const orbitRotate = useTransform(smoothX, [-1, 1], [-4, 4]);

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (reduceMotion) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerX.set((event.clientX - bounds.left) / bounds.width * 2 - 1);
    pointerY.set((event.clientY - bounds.top) / bounds.height * 2 - 1);
  }

  function handlePointerLeave() {
    pointerX.set(0);
    pointerY.set(0);
  }

  return (
    <motion.div
      className="agency-hero-visual"
      aria-label="Webgenixx digital technology services"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.92, y: 28 }}
      animate={reduceMotion ? undefined : { opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.12 }}
    >
      <motion.div className="hero-glow hero-glow-one" style={{ x: useTransform(smoothX, [-1, 1], [-12, 12]), y: useTransform(smoothY, [-1, 1], [-8, 8]) }} />
      <motion.div className="hero-glow hero-glow-two" style={{ x: useTransform(smoothX, [-1, 1], [10, -10]), y: useTransform(smoothY, [-1, 1], [8, -8]) }} />
      <motion.div className="hero-orbit hero-orbit-one" style={{ rotate: orbitRotate }} />
      <motion.div className="hero-orbit hero-orbit-two" style={{ rotate: useTransform(smoothX, [-1, 1], [4, -4]) }} />
      <span className="hero-particle particle-one" /><span className="hero-particle particle-two" /><span className="hero-particle particle-three" />
      <motion.div className="hero-laptop" style={{ rotateX: laptopRotateX, rotateY: laptopRotateY, z: 20 }} animate={reduceMotion ? undefined : { y: [0, -12, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}>
        <div className="hero-screen"><div className="hero-screen-top"><span>webgenixx</span><span>2026 / 001</span></div><div className="hero-screen-mark">W<span>.</span></div><div className="hero-screen-title">Dream.<br /><em>Develop.</em><br />Deliver.</div><div className="hero-screen-footer"><span>Digital products that move</span><b>↗</b></div></div>
        <div className="hero-base"><span /><span /><span /></div>
      </motion.div>
      <motion.div className="hero-service-card service-web" style={{ x: useTransform(smoothX, [-1, 1], [-15, 15]), y: useTransform(smoothY, [-1, 1], [-10, 10]) }} animate={reduceMotion ? undefined : { y: [0, -9, 0] }} transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}><b>⌘</b><span>Web Development</span><i>↗</i></motion.div>
      <motion.div className="hero-service-card service-app" style={{ x: useTransform(smoothX, [-1, 1], [18, -18]), y: useTransform(smoothY, [-1, 1], [8, -8]) }} animate={reduceMotion ? undefined : { y: [0, 9, 0] }} transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut', delay: .7 }}><b>▣</b><span>Mobile Apps</span><i>↗</i></motion.div>
      <motion.div className="hero-service-card service-cloud" style={{ x: useTransform(smoothX, [-1, 1], [-20, 20]), y: useTransform(smoothY, [-1, 1], [12, -12]) }} animate={reduceMotion ? undefined : { y: [0, -8, 0] }} transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut', delay: 1.1 }}><b>☁</b><span>Cloud Solutions</span><i>↗</i></motion.div>
      <motion.div className="hero-service-card service-growth" style={{ x: useTransform(smoothX, [-1, 1], [14, -14]), y: useTransform(smoothY, [-1, 1], [16, -16]) }} animate={reduceMotion ? undefined : { y: [0, 8, 0] }} transition={{ duration: 5.7, repeat: Infinity, ease: 'easeInOut', delay: 1.6 }}><b>⌁</b><span>Digital Growth</span><i>↗</i></motion.div>
    </motion.div>
  );
}
