'use client';

import { ChangeEvent, use, useEffect, useRef, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type Photo = {
  id: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  originalFilename?: string;
};

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

async function readResponse(response: Response) {
  const data = (await response.json()) as { message?: string };
  if (!response.ok) throw new Error(data.message ?? 'The request could not be completed.');
  return data;
}

export default function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [token, setToken] = useState('');
  const [consent, setConsent] = useState(false);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState('Accept the privacy notice to find your photos.');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    const saved = window.sessionStorage.getItem(`pixme:${slug}`);
    if (saved) {
      setToken(saved);
      setConsent(true);
      setStatus('Take a clear selfie in good light.');
    }

    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [slug]);

  async function startSession() {
    setError('');
    const response = await fetch(
      `${API_URL}/public/events/${encodeURIComponent(slug)}/guest-sessions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true, consentVersion: '2026-01' }),
      },
    );
    const data = await readResponse(response) as { token: string };
    setToken(data.token);
    setConsent(true);
    setStatus('Take a clear selfie in good light.');
    window.sessionStorage.setItem(`pixme:${slug}`, data.token);
  }

  async function pollMatches(sessionToken: string) {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      const result = await fetch(`${API_URL}/guest/matches`, {
        headers: authHeaders(sessionToken),
      });
      if (!result.ok) return;
      const matches = await result.json() as {
        status?: string;
        items?: Photo[];
        photos?: Photo[];
      };
      if (matches.status === 'PROCESSING') return;
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      const items = matches.items ?? matches.photos ?? [];
      setPhotos(items);
      setStatus(items.length ? 'Your private gallery' : 'No matches yet. Try another selfie in better light.');
    }, 1800);
  }

  async function submitSelfie() {
    if (!selfie || !token) return;
    setError('');
    setStatus('Processing your selfie securely…');
    const form = new FormData();
    form.append('selfie', selfie);
    const response = await fetch(`${API_URL}/guest/selfie`, {
      method: 'POST',
      headers: authHeaders(token),
      body: form,
    });
    await readResponse(response);
    setStatus('Finding your photographs…');
    await pollMatches(token);
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    setSelfie(event.target.files?.[0] ?? null);
  }

  async function downloadPhoto(photo: Photo) {
    if (!token) return;
    setError('');
    const response = await fetch(`${API_URL}/guest/photos/${photo.id}/download`, {
      headers: authHeaders(token),
    });
    const data = await readResponse(response) as { url?: string };
    if (!data.url) {
      setError('This download is not available.');
      return;
    }
    window.open(data.url, '_blank', 'noopener,noreferrer');
  }

  return (
    <main className="shell">
      <div className="brand">pixme.</div>
      <div className="stack">
        <section className="card">
          <span className="notice">Private event gallery</span>
          <h1>Find the moments you&apos;re in.</h1>
          <p className="notice">
            Your selfie is used only to match this event and is removed after processing.
            It is never compared with another event.
          </p>
          {!consent ? (
            <button
              className="button"
              onClick={() => void startSession().catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to start session.'))}
            >
              I understand and agree
            </button>
          ) : (
            <div className="stack">
              <input ref={inputRef} type="file" accept="image/*" capture="user" onChange={handleFile} />
              <div className="row">
                <button className="button" disabled={!selfie || !token} onClick={() => void submitSelfie().catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to process selfie.'))}>
                  Find my photos
                </button>
                <button className="button secondary" onClick={() => inputRef.current?.click()}>
                  Choose another
                </button>
              </div>
            </div>
          )}
          <p className="notice">{status}</p>
          {error && <p className="error">{error}</p>}
        </section>
        {photos.length > 0 && (
          <section className="card">
            <div className="gallery-heading">
              <div><span className="eyebrow">Private gallery</span><h2>Your moments</h2></div>
              <span className="photo-total">{photos.length} photos</span>
            </div>
            <div className="gallery">
              {photos.map((photo) => (
                <article className="gallery-item" key={photo.id}>
                  <a href={photo.previewUrl ?? photo.thumbnailUrl} target="_blank" rel="noreferrer">
                    <img className="photo" src={photo.previewUrl ?? photo.thumbnailUrl} alt={photo.originalFilename ?? 'Matched event photo'} loading="lazy" />
                  </a>
                  <button className="download-button" onClick={() => void downloadPhoto(photo)}>↓ Download</button>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
