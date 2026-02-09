export const WIDGET_CSS = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #1a1a2e;
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
  width: 380px;
  max-height: 520px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
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

.pw-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: #6366f1;
  color: white;
}

.pw-header h3 {
  font-size: 15px;
  font-weight: 600;
}

.pw-close {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
}

.pw-close:hover {
  background: rgba(255,255,255,0.2);
}

.pw-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  flex: 1;
}

.pw-field label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.pw-field input,
.pw-field textarea,
.pw-field select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}

.pw-field input:focus,
.pw-field textarea:focus,
.pw-field select:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.pw-field textarea {
  resize: vertical;
  min-height: 80px;
}

.pw-screenshots {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.pw-screenshot-wrap {
  position: relative;
  width: 60px;
  height: 60px;
}

.pw-screenshot-thumb {
  width: 60px;
  height: 60px;
  border-radius: 6px;
  object-fit: cover;
  border: 1px solid #e2e8f0;
}

.pw-screenshot-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #dc2626;
  color: white;
  border: 2px solid white;
  font-size: 11px;
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

.pw-actions {
  display: flex;
  gap: 8px;
}

.pw-btn {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  background: white;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: background 0.15s;
}

.pw-btn:hover {
  background: #f8fafc;
}

.pw-btn svg {
  width: 16px;
  height: 16px;
}

.pw-footer {
  padding: 12px 16px;
  border-top: 1px solid #f1f5f9;
}

.pw-submit {
  width: 100%;
  padding: 10px;
  background: #6366f1;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.pw-submit:hover {
  background: #4f46e5;
}

.pw-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.pw-success {
  text-align: center;
  padding: 32px 16px;
  color: #16a34a;
}

.pw-success svg {
  width: 48px;
  height: 48px;
  fill: #16a34a;
  margin-bottom: 12px;
}

.pw-success p {
  font-size: 15px;
  font-weight: 600;
}

.pw-error {
  padding: 8px 12px;
  background: #fef2f2;
  color: #dc2626;
  border-radius: 6px;
  font-size: 13px;
}

.pw-hidden {
  display: none !important;
}
`;
