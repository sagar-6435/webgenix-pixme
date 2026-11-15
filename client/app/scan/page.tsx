'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

type BarcodeDetectorLike = {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>;
};

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState(false);
  const [eventUrl, setEventUrl] = useState('');
  const [error, setError] = useState('');

  async function startCamera() {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not available in this browser. Paste your event link below.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCamera(true);
    } catch {
      setError('Camera permission was declined. Paste your event link below to continue.');
    }
  }

  useEffect(() => () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!camera || !videoRef.current) return;
    const detectorConstructor = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!detectorConstructor) return;
    const detector = new detectorConstructor({ formats: ['qr_code'] });
    const timer = window.setInterval(async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      const results = await detector.detect(video);
      const value = results[0]?.rawValue;
      if (!value) return;
      try {
        const url = new URL(value);
        window.location.href = url.pathname;
      } catch {
        setError('That QR code does not contain a valid Pixme event link.');
      }
    }, 700);
    return () => window.clearInterval(timer);
  }, [camera]);

  function openEvent() {
    try {
      const url = new URL(eventUrl);
      window.location.href = url.pathname;
    } catch {
      setError('Enter a complete event link, for example https://pixme.app/e/sarah-and-james.');
    }
  }

  return <main className="dark-page"><nav className="nav shell"><Link className="brand brand-light" href="/">pixme<span>.</span></Link><Link className="text-link light-link" href="/">Back home</Link></nav><section className="scanner-wrap shell"><div className="eyebrow light-eyebrow"><span className="eyebrow-dot" /> Guest access</div><h1>Scan to find<br /><em>your photos.</em></h1><p className="lead light-copy">Point your camera at the event QR code. You&apos;ll be taken to a private gallery made just for you.</p><div className="scanner-card"><div className="scanner-window">{camera ? <video ref={videoRef} autoPlay playsInline muted /> : <><div className="scan-corners" /><div className="qr-placeholder"><span>⌁</span></div><p>Position the QR code inside the frame</p></>}</div><button className="button" onClick={() => void startCamera()}>{camera ? 'Camera ready' : 'Open camera'} <span>⌁</span></button><div className="or-divider"><span>or continue with a link</span></div><div className="input-row"><input value={eventUrl} onChange={(event) => setEventUrl(event.target.value)} placeholder="Paste your event link" /><button className="button button-small" onClick={openEvent}>Go</button></div>{error && <p className="error">{error}</p>}</div><p className="privacy-note">Your event link is safe to share. Face matching only starts after explicit consent.</p></section></main>;
}
