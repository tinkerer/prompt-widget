import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { applications, navigate } from '../lib/state.js';
import { allSessions, openSession, getSessionLabel } from '../lib/sessions.js';
import { recentResults, type RecentResult } from '../lib/settings.js';
import { api } from '../lib/api.js';

interface SearchResult {
  type: 'application' | 'feedback' | 'session';
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  route: string;
}

interface Props {
  onClose: () => void;
}

export function SpotlightSearch({ onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback((q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }

    const lower = q.toLowerCase();
    const matched: SearchResult[] = [];

    // Search applications (local)
    for (const app of applications.value) {
      if (app.name?.toLowerCase().includes(lower) || app.id?.toLowerCase().includes(lower)) {
        matched.push({
          type: 'application',
          id: app.id,
          title: app.name,
          subtitle: app.projectDir || app.id.slice(0, 12),
          icon: '\u{1F4E6}',
          route: `/app/${app.id}/feedback`,
        });
      }
    }

    // Search sessions (local)
    for (const s of allSessions.value) {
      if (s.status === 'deleted') continue;
      const customLabel = getSessionLabel(s.id);
      const label = customLabel || s.feedbackTitle || s.agentName || s.id;
      const searchable = [label, s.id, s.paneTitle, s.paneCommand, s.panePath].filter(Boolean).join(' ').toLowerCase();
      if (searchable.includes(lower)) {
        const isPlain = s.permissionProfile === 'plain';
        const plainLabel = s.paneCommand
          ? `${s.paneCommand}:${s.panePath || ''} \u2014 ${s.paneTitle || s.id.slice(-6)}`
          : (s.paneTitle || s.id.slice(-6));
        matched.push({
          type: 'session',
          id: s.id,
          title: customLabel || (isPlain ? `\u{1F5A5}\uFE0F ${plainLabel}` : (s.feedbackTitle || s.agentName || `Session ${s.id.slice(-6)}`)),
          subtitle: s.status,
          icon: isPlain ? '\u{1F4BB}' : '\u26A1',
          route: '',
        });
      }
    }

    setResults(matched);
    setSelectedIndex(0);

    // Search feedback (API, debounced)
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params: Record<string, string | number> = { search: q, limit: 10 };
        const res = await api.getFeedback(params);
        setResults((prev) => {
          const feedbackResults: SearchResult[] = res.items.map((item: any) => ({
            type: 'feedback' as const,
            id: item.id,
            title: item.title || 'Untitled feedback',
            subtitle: `${item.status || 'new'}${item.shortId ? ` \u00B7 ${item.shortId}` : ''}`,
            icon: '\u{1F4CB}',
            route: `/app/${item.appId || '__unlinked__'}/feedback/${item.id}`,
          }));
          // Replace existing feedback results, keep app/session results
          const nonFeedback = prev.filter((r) => r.type !== 'feedback');
          return [...nonFeedback, ...feedbackResults];
        });
      } catch {
        // ignore search errors
      } finally {
        setLoading(false);
      }
    }, 200);
  }, []);

  useEffect(() => {
    search(query);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function selectResult(result: SearchResult) {
    const entry: RecentResult = { type: result.type, id: result.id, title: result.title, subtitle: result.subtitle, icon: result.icon, route: result.route };
    recentResults.value = [entry, ...recentResults.value.filter((r) => r.id !== result.id)].slice(0, 10);
    if (result.type === 'session') {
      openSession(result.id);
    } else {
      navigate(result.route);
    }
    onClose();
  }

  function handleKeyDown(e: KeyboardEvent) {
    const showingRecent = !query && recentResults.value.length > 0;
    const listLen = showingRecent ? recentResults.value.length : results.length;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, listLen - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showingRecent && selectedIndex < recentResults.value.length) {
        const r = recentResults.value[selectedIndex];
        if (r.type === 'session') {
          openSession(r.id);
        } else {
          navigate(r.route);
        }
        onClose();
      } else if (results.length > 0) {
        selectResult(results[selectedIndex]);
      }
    }
  }

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector('.spotlight-result.selected') as HTMLElement;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const grouped = groupResults(results);

  return (
    <div class="spotlight-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="spotlight-container">
        <div class="spotlight-input-row">
          <span class="spotlight-search-icon">{'\u{1F50D}'}</span>
          <input
            ref={inputRef}
            type="text"
            class="spotlight-input"
            placeholder="Search applications, feedback, sessions..."
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={handleKeyDown}
          />
          {loading && <span class="spotlight-spinner" />}
          <kbd class="spotlight-esc">esc</kbd>
        </div>
        {!query && recentResults.value.length > 0 && (
          <div class="spotlight-results" ref={listRef}>
            <div class="spotlight-category spotlight-recent-header">
              <span>Recent</span>
              <button class="spotlight-clear-recent" onClick={() => { recentResults.value = []; }}>Clear</button>
            </div>
            {recentResults.value.map((r, i) => (
              <div
                key={r.id}
                class={`spotlight-result ${i === selectedIndex ? 'selected' : ''}`}
                onClick={() => {
                  if (r.type === 'session') { openSession(r.id); } else { navigate(r.route); }
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span class="spotlight-result-icon">{r.icon}</span>
                <div class="spotlight-result-text">
                  <span class="spotlight-result-title">{r.title}</span>
                  {r.subtitle && <span class="spotlight-result-subtitle">{r.subtitle}</span>}
                </div>
                <span class="spotlight-result-type">{r.type}</span>
              </div>
            ))}
          </div>
        )}
        {results.length > 0 && (
          <div class="spotlight-results" ref={listRef}>
            {grouped.map(([category, items]) => (
              <div key={category}>
                <div class="spotlight-category">{category}</div>
                {items.map((r) => {
                  const globalIdx = results.indexOf(r);
                  return (
                    <div
                      key={r.id}
                      class={`spotlight-result ${globalIdx === selectedIndex ? 'selected' : ''}`}
                      onClick={() => selectResult(r)}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                    >
                      <span class="spotlight-result-icon">{r.icon}</span>
                      <div class="spotlight-result-text">
                        <span class="spotlight-result-title">{r.title}</span>
                        {r.subtitle && <span class="spotlight-result-subtitle">{r.subtitle}</span>}
                      </div>
                      <span class="spotlight-result-type">{r.type}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {query && results.length === 0 && !loading && (
          <div class="spotlight-empty">No results found</div>
        )}
      </div>
    </div>
  );
}

function groupResults(results: SearchResult[]): [string, SearchResult[]][] {
  const groups: [string, SearchResult[]][] = [];
  const byType: Record<string, SearchResult[]> = {};
  for (const r of results) {
    if (!byType[r.type]) byType[r.type] = [];
    byType[r.type].push(r);
  }
  const order: [string, string][] = [
    ['application', 'Applications'],
    ['session', 'Sessions'],
    ['feedback', 'Feedback'],
  ];
  for (const [type, label] of order) {
    if (byType[type]?.length) groups.push([label, byType[type]]);
  }
  return groups;
}
