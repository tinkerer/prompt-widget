import { useState, useEffect, useCallback } from 'preact/hooks';

interface GuideStep {
  selector: string;
  title: string;
  text: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export interface GuideDef {
  id: string;
  name: string;
  steps: GuideStep[];
}

export const GUIDES: GuideDef[] = [
  {
    id: 'welcome-tour',
    name: 'Welcome Tour',
    steps: [
      {
        selector: '.sidebar-title',
        title: 'Welcome to Prompt Widget',
        text: 'This is your admin dashboard for managing feedback, agents, and sessions. Let\'s take a quick tour.',
        position: 'right',
      },
      {
        selector: '.sidebar nav',
        title: 'Navigation',
        text: 'Your apps and their sub-pages are listed here. Click an app to see its feedback, agents, and more.',
        position: 'right',
      },
      {
        selector: '.sidebar-sessions-header',
        title: 'Session Drawer',
        text: 'Terminal sessions appear here. Click to expand and see active agent sessions.',
        position: 'right',
      },
      {
        selector: '.main',
        title: 'Main Content',
        text: 'The main area shows the selected page. Try pressing ? at any time to see keyboard shortcuts.',
        position: 'left',
      },
    ],
  },
  {
    id: 'feedback-workflow',
    name: 'Feedback Workflow',
    steps: [
      {
        selector: '.table-wrap',
        title: 'Feedback List',
        text: 'All feedback items are shown here. Use filters at the top to narrow results. Select items with checkboxes for batch actions.',
        position: 'top',
      },
      {
        selector: '.btn-dispatch-quick',
        title: 'Quick Dispatch',
        text: 'Click the play button to quickly dispatch feedback to the default agent for this app.',
        position: 'left',
      },
    ],
  },
];

function isGuideCompleted(id: string): boolean {
  try {
    const completed = JSON.parse(localStorage.getItem('pw-guides-completed') || '[]');
    return completed.includes(id);
  } catch {
    return false;
  }
}

function markGuideCompleted(id: string) {
  try {
    const completed = JSON.parse(localStorage.getItem('pw-guides-completed') || '[]');
    if (!completed.includes(id)) {
      completed.push(id);
      localStorage.setItem('pw-guides-completed', JSON.stringify(completed));
    }
  } catch { /* */ }
}

export function resetGuide(id: string) {
  try {
    const completed = JSON.parse(localStorage.getItem('pw-guides-completed') || '[]');
    const filtered = completed.filter((c: string) => c !== id);
    localStorage.setItem('pw-guides-completed', JSON.stringify(filtered));
  } catch { /* */ }
}

interface GuideProps {
  guide: GuideDef;
  onClose: () => void;
}

export function Guide({ guide, onClose }: GuideProps) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const current = guide.steps[step];

  const updateRect = useCallback(() => {
    if (!current) return;
    const el = document.querySelector(current.selector);
    if (el) {
      setRect(el.getBoundingClientRect());
    } else {
      setRect(null);
    }
  }, [current]);

  useEffect(() => {
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [updateRect]);

  function next() {
    if (step < guide.steps.length - 1) {
      setStep(step + 1);
    } else {
      markGuideCompleted(guide.id);
      onClose();
    }
  }

  function prev() {
    if (step > 0) setStep(step - 1);
  }

  function skip() {
    markGuideCompleted(guide.id);
    onClose();
  }

  const pad = 8;
  const spotStyle = rect
    ? {
        top: `${rect.top - pad}px`,
        left: `${rect.left - pad}px`,
        width: `${rect.width + pad * 2}px`,
        height: `${rect.height + pad * 2}px`,
      }
    : { top: '50%', left: '50%', width: '0px', height: '0px' };

  const pos = current?.position || 'bottom';
  const popoverStyle: Record<string, string> = {};
  if (rect) {
    if (pos === 'bottom') {
      popoverStyle.top = `${rect.bottom + pad + 12}px`;
      popoverStyle.left = `${Math.max(16, rect.left)}px`;
    } else if (pos === 'top') {
      popoverStyle.bottom = `${window.innerHeight - rect.top + pad + 12}px`;
      popoverStyle.left = `${Math.max(16, rect.left)}px`;
    } else if (pos === 'right') {
      popoverStyle.top = `${rect.top}px`;
      popoverStyle.left = `${rect.right + pad + 12}px`;
    } else {
      popoverStyle.top = `${rect.top}px`;
      popoverStyle.right = `${window.innerWidth - rect.left + pad + 12}px`;
    }
  }

  return (
    <div class="guide-overlay">
      <div class="guide-backdrop" onClick={skip} />
      <div class="guide-spotlight" style={spotStyle} />
      <div class="guide-popover" style={popoverStyle}>
        <h4>{current?.title}</h4>
        <p>{current?.text}</p>
        <div class="guide-footer">
          <span class="guide-steps">{step + 1} / {guide.steps.length}</span>
          <div class="guide-actions">
            <button class="btn btn-sm" onClick={skip}>Skip</button>
            {step > 0 && <button class="btn btn-sm" onClick={prev}>Back</button>}
            <button class="btn btn-sm btn-primary" onClick={next}>
              {step < guide.steps.length - 1 ? 'Next' : 'Done'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
