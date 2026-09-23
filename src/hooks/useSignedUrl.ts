'use client';

import { useState, useEffect } from 'react';

// Module-level cache shared across all hook instances
const urlCache = new Map<string, { url: string; expiry: number }>();

/**
 * Resolves a Supabase storage path to a fresh signed URL.
 * If content is already a full URL (e.g. ImgBB), returns it as-is.
 */
export function useSignedUrl(content: string): string | null {
  const [url, setUrl] = useState<string | null>(() => {
    if (!content) return null;
    if (content.startsWith('http')) return content;

    const cached = urlCache.get(content);
    if (cached && cached.expiry > Date.now()) return cached.url;
    return null;
  });

  useEffect(() => {
    if (!content) {
      setUrl(null);
      return;
    }

    if (content.startsWith('http')) {
      setUrl(content);
      return;
    }

    // Check cache
    const cached = urlCache.get(content);
    if (cached && cached.expiry > Date.now()) {
      setUrl(cached.url);
      return;
    }

    let cancelled = false;

    const fetchUrl = async () => {
      try {
        const res = await fetch('/api/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: content }),
        });
        const data = await res.json();

        if (cancelled) return;

        if (data.success) {
          urlCache.set(content, {
            url: data.signedUrl,
            expiry: Date.now() + 55 * 60 * 1000, // cache for 55 min (URL valid 1h)
          });
          setUrl(data.signedUrl);
        } else {
          setUrl(null);
        }
      } catch {
        if (!cancelled) setUrl(null);
      }
    };

    fetchUrl();

    return () => {
      cancelled = true;
    };
  }, [content]);

  return url;
}
