import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { api } from '../lib/api.js';
import { navigate, selectedAppId } from '../lib/state.js';

const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 30_000;

export function FeedbackCompanionView({ feedbackId }: { feedbackId: string }) {
  const fb = signal<any>(null);
  const loading = signal(true);
  const error = signal('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const cached = cache.get(feedbackId);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        fb.value = cached.data;
        loading.value = false;
        return;
      }
      loading.value = true;
      error.value = '';
      try {
        const data = await api.getFeedbackById(feedbackId);
        if (!cancelled) {
          fb.value = data;
          cache.set(feedbackId, { data, ts: Date.now() });
        }
      } catch (err: any) {
        if (!cancelled) error.value = err.message;
      } finally {
        if (!cancelled) loading.value = false;
      }
    }
    load();
    return () => { cancelled = true; };
  }, [feedbackId]);

  if (loading.value) {
    return <div class="companion-loading">Loading feedback...</div>;
  }
  if (error.value) {
    return <div class="companion-error">{error.value}</div>;
  }
  const f = fb.value;
  if (!f) return null;

  const appId = selectedAppId.value;
  const detailPath = appId
    ? `/app/${appId}/feedback/${feedbackId}`
    : `/feedback/${feedbackId}`;

  return (
    <div class="feedback-companion">
      <div class="feedback-companion-header">
        <span class={`status-badge status-${f.status}`}>{f.status}</span>
        <a
          href={`#${detailPath}`}
          class="feedback-companion-link"
          onClick={(e) => { e.preventDefault(); navigate(detailPath); }}
        >
          Open full detail
        </a>
      </div>
      <h3 class="feedback-companion-title">{f.title || 'Untitled'}</h3>
      {f.description && (
        <p class="feedback-companion-desc">{f.description}</p>
      )}
      {f.tags && f.tags.length > 0 && (
        <div class="feedback-companion-tags">
          {f.tags.map((tag: string) => (
            <span key={tag} class="feedback-companion-tag">{tag}</span>
          ))}
        </div>
      )}
      {f.screenshotId && (
        <div class="feedback-companion-screenshot">
          <img
            src={`/api/v1/images/${f.screenshotId}`}
            alt="Screenshot"
            loading="lazy"
          />
        </div>
      )}
      {f.type && (
        <div class="feedback-companion-meta">
          <span>Type: {f.type}</span>
          {f.createdAt && <span>Created: {new Date(f.createdAt).toLocaleString()}</span>}
        </div>
      )}
    </div>
  );
}
