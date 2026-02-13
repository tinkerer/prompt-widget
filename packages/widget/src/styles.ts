export const WIDGET_CSS = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #e2e8f0;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.pw-trigger {
  position: fixed;
  z-index: 2147483647;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #6366f1;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
  transition: transform 0.2s, box-shadow 0.2s;
}

.pw-trigger:hover {
  transform: scale(1.1);
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.5);
}

.pw-trigger svg {
  width: 24px;
  height: 24px;
  fill: white;
}

.pw-trigger.bottom-right { bottom: 20px; right: 20px; }
.pw-trigger.bottom-left { bottom: 20px; left: 20px; }
.pw-trigger.top-right { top: 20px; right: 20px; }
.pw-trigger.top-left { top: 20px; left: 20px; }

.pw-panel {
  position: fixed;
  z-index: 2147483647;
  width: 340px;
  background: #1e293b;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: pw-slide-in 0.2s ease-out;
}

.pw-panel.bottom-right { bottom: 80px; right: 20px; }
.pw-panel.bottom-left { bottom: 80px; left: 20px; }
.pw-panel.top-right { top: 80px; right: 20px; }
.pw-panel.top-left { top: 80px; left: 20px; }

@keyframes pw-slide-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.pw-close {
  position: absolute;
  top: 4px;
  right: 4px;
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
}

.pw-close:hover {
  color: #e2e8f0;
  background: rgba(255,255,255,0.1);
}

.pw-screenshots {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px 10px 0;
}

.pw-screenshot-wrap {
  position: relative;
  width: 40px;
  height: 40px;
}

.pw-screenshot-thumb {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  object-fit: cover;
  border: 1px solid #334155;
}

.pw-screenshot-remove {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #dc2626;
  color: white;
  border: 1px solid #1e293b;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.pw-screenshot-remove:hover {
  background: #b91c1c;
}

.pw-input-bar {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 8px;
}

.pw-camera-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: none;
  background: #334155;
  color: #94a3b8;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.pw-camera-btn:hover {
  background: #475569;
  color: #e2e8f0;
}

.pw-camera-btn svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.pw-chat-input {
  flex: 1;
  height: 32px;
  padding: 0 10px;
  margin-left: 6px;
  border: 1px solid #334155;
  border-radius: 6px;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}

.pw-chat-input::placeholder {
  color: #64748b;
}

.pw-chat-input:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
}

.pw-flash {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #22c55e;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.pw-flash svg {
  width: 28px;
  height: 28px;
  fill: #22c55e;
}

.pw-error {
  padding: 4px 10px 8px;
  color: #f87171;
  font-size: 12px;
}

.pw-hidden {
  display: none !important;
}
`;
